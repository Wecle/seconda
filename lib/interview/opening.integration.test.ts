import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AgentRunInput } from "@/lib/agent/types";
import * as schema from "@/lib/db/schema";
import {
  agentEvents,
  agentRuns,
  agentSessions,
  interviewAgentRuns,
  interviewQuestions,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
const databaseUrl = process.env.DATABASE_URL;

test("opening run is claimed once and commits the first question atomically and idempotently", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const [
    { createInterview },
    { commitInterviewAgentAction },
    { executeInterviewOpening },
    { claimInterviewOpeningRun },
  ] = await Promise.all([
    import("./application/create-interview"),
    import("./application/commit-agent-action"),
    import("./application/execute-opening"),
    import("./persistence/repository"),
  ]);
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
  const [resume] = await database.insert(resumes).values({ userId, title: "Opening Resume" }).returning();
  const [version] = await database.insert(resumeVersions).values({
    resumeId: resume.id,
    versionNumber: 1,
    sourceType: "generated",
    parsedJson: {
      name: "Candidate",
      title: "Platform Engineer",
      skills: ["TypeScript"],
      experience: [{
        title: "Engineer",
        company: "Seconda",
        period: "2024-present",
        bullets: ["Built an event-driven agent runtime"],
      }],
    },
    parseStatus: "parsed",
  }).returning();
  try {
    const created = await createInterview({
      userId,
      idempotencyKey: "opening-integration",
      request: {
        resumeVersionId: version.id,
        language: "zh",
        persona: "standard",
        interviewType: "mixed",
        targetLevel: "Senior",
        targetRole: "Platform Engineer",
        preference: "深入项目",
        preferenceTags: ["project_deep_dive"],
        targetRoundCount: 5,
      },
    }, { database, model: "test/model" });
    const claimInput = {
      database,
      userId,
      openingRunId: created.openingRunId,
      buildModelMessage: () => ({ role: "user" as const, content: "untrusted opening context" }),
    };
    const [first, second] = await Promise.all([
      claimInterviewOpeningRun(claimInput),
      claimInterviewOpeningRun(claimInput),
    ]);
    const claimed = [first, second].find((item) => item.state === "claimed");
    assert.ok(claimed?.state === "claimed");
    assert.equal([first, second].filter((item) => item.state === "claimed").length, 1);
    const evidenceId = Object.keys(claimed.snapshot.evidenceJson as object)[0];
    await assert.rejects(commitInterviewAgentAction({
      userId,
      sessionId: claimed.session.id,
      agentRunId: claimed.agentRun.id,
      interviewId: claimed.interview.id,
      interviewRunId: claimed.logicalRun.id,
      attemptGeneration: claimed.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: null,
        action: {
          type: "ask_question",
          kind: "main",
          question: "伪造依据的问题？",
          topic: "项目经历",
          resumeEvidenceIds: ["ev_ffffffffffffffff"],
        },
      },
    }, { database }), /unknown resume evidence/);
    const proposal = {
      answerAnalysis: null,
      action: {
        type: "ask_question",
        kind: "main",
        question: "  请介绍你构建事件驱动 Agent Runtime 时最大的技术挑战。  ",
        topic: "  项目经历  ",
        resumeEvidenceIds: [evidenceId],
      },
    };
    const committed = await commitInterviewAgentAction({
      userId,
      sessionId: claimed.session.id,
      agentRunId: claimed.agentRun.id,
      interviewId: claimed.interview.id,
      interviewRunId: claimed.logicalRun.id,
      attemptGeneration: claimed.logicalRun.attemptGeneration,
      action: proposal,
    }, { database });
    const replayed = await commitInterviewAgentAction({
      userId,
      sessionId: claimed.session.id,
      agentRunId: claimed.agentRun.id,
      interviewId: claimed.interview.id,
      interviewRunId: claimed.logicalRun.id,
      attemptGeneration: claimed.logicalRun.attemptGeneration,
      action: proposal,
    }, { database });
    assert.equal(replayed.id, committed.id);
    await assert.rejects(commitInterviewAgentAction({
      userId,
      sessionId: claimed.session.id,
      agentRunId: claimed.agentRun.id,
      interviewId: claimed.interview.id,
      interviewRunId: claimed.logicalRun.id,
      attemptGeneration: claimed.logicalRun.attemptGeneration,
      action: {
        ...proposal,
        action: { ...proposal.action, question: "不同的重放问题" },
      },
    }, { database }), /replay does not match/);
    const [interview] = await database.select().from(interviews).where(eq(interviews.id, created.interviewId));
    const [logicalRun] = await database.select().from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, created.openingRunId));
    const questions = await database.select().from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, created.interviewId));
    const events = await database.select().from(agentEvents).where(and(
      eq(agentEvents.sessionId, created.agentSessionId),
      eq(agentEvents.type, "interview/question_committed"),
    ));
    assert.equal(interview.status, "active");
    assert.equal(interview.version, 2);
    assert.ok(interview.startedAt);
    assert.equal(logicalRun.status, "completed");
    assert.equal(logicalRun.attemptCount, 1);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].question, "请介绍你构建事件驱动 Agent Runtime 时最大的技术挑战。");
    assert.equal(events.length, 1);
    assert.equal(events[0].visibility, "model_and_user");
    const [run] = await database.select().from(agentRuns).where(eq(agentRuns.id, created.agentRunId));
    const [session] = await database.select().from(agentSessions).where(eq(agentSessions.id, created.agentSessionId));
    assert.equal(run.status, "running");
    assert.equal(session.status, "running");

    const executorCreation = await createInterview({
      userId,
      idempotencyKey: "opening-executor-replay",
      request: {
        resumeVersionId: version.id,
        language: "zh",
        persona: "standard",
        interviewType: "mixed",
        targetLevel: "Senior",
        targetRole: "Platform Engineer",
        preference: "深入项目",
        preferenceTags: ["project_deep_dive"],
        targetRoundCount: 5,
      },
    }, { database, model: "test/model" });
    let modelCalls = 0;
    const fakeRun = async (agentInput: AgentRunInput) => {
      modelCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      await agentInput.events.append("step_started", { step: 1, attempt: 1 });
      await agentInput.events.append("assistant_chunk", {
        chunk: { type: "block-start", index: 0, blockType: "reasoning" },
      });
      await agentInput.events.append("assistant_chunk", {
        chunk: { type: "reasoning-delta", index: 0, text: "Inspect the event-driven project." },
      });
      await agentInput.events.append("assistant_chunk", {
        chunk: { type: "block-end", index: 0, blockType: "reasoning" },
      });
      const config = agentInput.capabilityConfig as {
        interviewId: string;
        interviewRunId: string;
        attemptGeneration: number;
      };
      await commitInterviewAgentAction({
        userId: agentInput.userId,
        sessionId: agentInput.sessionId,
        agentRunId: agentInput.runId,
        interviewId: config.interviewId,
        interviewRunId: config.interviewRunId,
        attemptGeneration: config.attemptGeneration,
        action: {
          answerAnalysis: null,
          action: {
            type: "ask_question",
            kind: "main",
            question: "请说明你如何设计事件驱动系统。",
            topic: "系统设计",
            resumeEvidenceIds: [evidenceId],
          },
        },
      }, { database });
      return { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    };
    const executions = await Promise.all(Array.from({ length: 2 }, () => executeInterviewOpening({
      userId,
      openingRunId: executorCreation.openingRunId,
    }, {
      database,
      run: fakeRun as typeof import("@/lib/agent/runtime").runAgent,
      signal: new AbortController().signal,
    })));
    assert.equal(modelCalls, 1);
    assert.equal(executions[0].question.id, executions[1].question.id);
    const [settledRun] = await database.select().from(agentRuns)
      .where(eq(agentRuns.id, executorCreation.agentRunId));
    const [settledSession] = await database.select().from(agentSessions)
      .where(eq(agentSessions.id, executorCreation.agentSessionId));
    assert.equal(settledRun.status, "completed");
    assert.equal(settledSession.status, "idle");
    const { getInterviewRoom } = await import("./application/get-interview-room");
    const room = await getInterviewRoom({
      userId,
      interviewId: executorCreation.interviewId,
    }, { database });
    assert.equal(room?.transcript[0]?.type, "reasoning");
    assert.equal(room?.transcript[0]?.content, "Inspect the event-driven project.");
    assert.equal(room?.transcript[0]?.type === "reasoning" && room.transcript[0].complete, true);
  } finally {
    await database.delete(interviews).where(eq(interviews.userId, userId));
    await database.delete(users).where(eq(users.id, userId));
    await client.end();
    const { closeAgentRepositoryConnection } = await import("@/lib/agent/repository");
    await closeAgentRepositoryConnection();
  }
});
