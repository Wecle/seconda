import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  agentRuns,
  agentEvents,
  agentSessions,
  interviewAgentRuns,
  interviewQuestions,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";

const databaseUrl = process.env.DATABASE_URL;

test("failed retry and expired-lease takeover fence stale interview attempts", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const [
    { createInterview },
    { commitInterviewAgentAction },
    { submitInterviewAnswer },
    {
      claimInterviewOpeningRun,
      claimInterviewTurnRun,
      failInterviewOpeningRun,
      failInterviewTurnRun,
      renewInterviewRunLease,
      retryInterviewRun,
    },
  ] = await Promise.all([
    import("./application/create-interview"),
    import("./application/commit-agent-action"),
    import("./application/submit-answer"),
    import("./persistence/repository"),
  ]);
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
  const [resume] = await database.insert(resumes).values({ userId, title: "Recovery Resume" }).returning();
  const [version] = await database.insert(resumeVersions).values({
    resumeId: resume.id,
    versionNumber: 1,
    sourceType: "generated",
    parsedJson: {
      name: "Candidate",
      title: "Platform Engineer",
      skills: ["TypeScript"],
      experience: [{ title: "Engineer", company: "Seconda", period: "2024-present", bullets: ["Built agents"] }],
    },
    parseStatus: "parsed",
  }).returning();
  try {
    const created = await createInterview({
      userId,
      idempotencyKey: "run-recovery",
      request: {
        resumeVersionId: version.id,
        language: "zh",
        persona: "standard",
        interviewType: "mixed",
        targetLevel: "Senior",
        targetRole: "Platform Engineer",
        preference: "",
        preferenceTags: [],
        targetRoundCount: 5,
      },
    }, { database, model: "test/model" });
    const buildModelMessage = () => ({ role: "user" as const, content: "recovery context" });
    const owner1 = randomUUID();
    const first = await claimInterviewOpeningRun({
      database,
      userId,
      openingRunId: created.openingRunId,
      leaseOwner: owner1,
      buildModelMessage,
    });
    assert.equal(first.state, "claimed");
    if (first.state !== "claimed") return;
    assert.equal(await renewInterviewRunLease({
      database,
      interviewRunId: first.logicalRun.id,
      agentRunId: first.agentRun.id,
      attemptGeneration: first.logicalRun.attemptGeneration,
      leaseOwner: randomUUID(),
    }), false);
    assert.equal(await failInterviewOpeningRun({
      database,
      openingRunId: first.logicalRun.id,
      agentRunId: first.agentRun.id,
      attemptGeneration: first.logicalRun.attemptGeneration,
      leaseOwner: owner1,
      errorCode: "TEST_FAILURE",
    }), true);
    const [failedAttempt] = await database.select({ status: agentRuns.status }).from(agentRuns)
      .where(eq(agentRuns.id, first.agentRun.id));
    const [failedSession] = await database.select({ status: agentSessions.status }).from(agentSessions)
      .where(eq(agentSessions.id, first.session.id));
    const failedEvents = await database.select({ type: agentEvents.type }).from(agentEvents)
      .where(and(eq(agentEvents.runId, first.agentRun.id), eq(agentEvents.type, "run_failed")));
    assert.equal(failedAttempt?.status, "failed");
    assert.equal(failedSession?.status, "failed");
    assert.equal(failedEvents.length, 1);

    await database.update(interviews).set({ status: "completing" }).where(eq(interviews.id, created.interviewId));
    const invalidRetry = await retryInterviewRun({
      database,
      userId,
      interviewId: created.interviewId,
      interviewRunId: first.logicalRun.id,
    });
    assert.equal(invalidRetry.state, "conflict");
    await database.update(interviews).set({ status: "initializing" }).where(eq(interviews.id, created.interviewId));
    const retried = await retryInterviewRun({
      database,
      userId,
      interviewId: created.interviewId,
      interviewRunId: first.logicalRun.id,
    });
    assert.equal(retried.state, "ready");
    if (retried.state !== "ready") return;
    const [closedFirstAttempt] = await database.select({ status: agentRuns.status }).from(agentRuns)
      .where(eq(agentRuns.id, first.agentRun.id));
    assert.equal(closedFirstAttempt?.status, "failed");
    const replayedRetry = await retryInterviewRun({
      database,
      userId,
      interviewId: created.interviewId,
      interviewRunId: first.logicalRun.id,
    });
    assert.equal(replayedRetry.state, "ready");
    if (replayedRetry.state !== "ready") return;
    assert.equal(replayedRetry.run.currentAgentRunId, retried.run.currentAgentRunId);

    const owner2 = randomUUID();
    const second = await claimInterviewOpeningRun({
      database,
      userId,
      openingRunId: created.openingRunId,
      leaseOwner: owner2,
      buildModelMessage,
    });
    assert.equal(second.state, "claimed");
    if (second.state !== "claimed") return;
    await database.update(interviewAgentRuns).set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(and(
        eq(interviewAgentRuns.id, second.logicalRun.id),
        eq(interviewAgentRuns.attemptGeneration, second.logicalRun.attemptGeneration),
      ));
    assert.equal(await failInterviewOpeningRun({
      database,
      openingRunId: second.logicalRun.id,
      agentRunId: second.agentRun.id,
      attemptGeneration: second.logicalRun.attemptGeneration,
      leaseOwner: owner2,
      errorCode: "STALE_EXECUTOR_FAILURE",
    }), false);

    const owner3 = randomUUID();
    const takeover = await claimInterviewOpeningRun({
      database,
      userId,
      openingRunId: created.openingRunId,
      leaseOwner: owner3,
      buildModelMessage,
    });
    assert.equal(takeover.state, "claimed");
    if (takeover.state !== "claimed") return;
    assert.equal(takeover.logicalRun.attemptGeneration, second.logicalRun.attemptGeneration + 1);
    assert.notEqual(takeover.agentRun.id, second.agentRun.id);
    assert.equal(await renewInterviewRunLease({
      database,
      interviewRunId: second.logicalRun.id,
      agentRunId: second.agentRun.id,
      attemptGeneration: second.logicalRun.attemptGeneration,
      leaseOwner: owner2,
    }), false);

    const evidenceId = Object.keys(takeover.snapshot.evidenceJson as object)[0];
    const action = {
      answerAnalysis: null,
      action: {
        type: "ask_question",
        kind: "main",
        question: "请介绍你构建 Agent 时最重要的技术取舍。",
        topic: "Agent 项目",
        resumeEvidenceIds: [evidenceId],
      },
    };
    await assert.rejects(commitInterviewAgentAction({
      userId,
      sessionId: second.session.id,
      agentRunId: second.agentRun.id,
      interviewId: second.interview.id,
      interviewRunId: second.logicalRun.id,
      attemptGeneration: second.logicalRun.attemptGeneration,
      leaseOwner: owner2,
      action,
    }, { database }), /identity mismatch|not authorized/);
    await commitInterviewAgentAction({
      userId,
      sessionId: takeover.session.id,
      agentRunId: takeover.agentRun.id,
      interviewId: takeover.interview.id,
      interviewRunId: takeover.logicalRun.id,
      attemptGeneration: takeover.logicalRun.attemptGeneration,
      leaseOwner: owner3,
      action,
    }, { database });
    const questions = await database.select({ id: interviewQuestions.id }).from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, created.interviewId));
    assert.equal(questions.length, 1);
    const [completedAttempt] = await database.select({ status: agentRuns.status }).from(agentRuns)
      .where(eq(agentRuns.id, takeover.agentRun.id));
    const [idleSession] = await database.select({ status: agentSessions.status }).from(agentSessions)
      .where(eq(agentSessions.id, takeover.session.id));
    const completedEvents = await database.select({ type: agentEvents.type }).from(agentEvents)
      .where(and(eq(agentEvents.runId, takeover.agentRun.id), eq(agentEvents.type, "run_completed")));
    assert.equal(completedAttempt?.status, "completed");
    assert.equal(idleSession?.status, "idle");
    assert.equal(completedEvents.length, 1);

    const answered = await submitInterviewAnswer({
      userId,
      interviewId: created.interviewId,
      idempotencyKey: "recovery-answer",
      request: { questionId: questions[0].id, content: "我会用持久化事件、幂等键和 fenced lease 恢复。", skipped: false },
    }, { database });
    const answerOwner1 = randomUUID();
    const firstAnswerAttempt = await claimInterviewTurnRun({
      database,
      userId,
      interviewRunId: answered.run.id,
      leaseOwner: answerOwner1,
      buildModelMessage: () => ({ role: "user", content: "answer context" }),
    });
    assert.equal(firstAnswerAttempt.state, "claimed");
    if (firstAnswerAttempt.state !== "claimed") return;
    assert.equal(await failInterviewTurnRun({
      database,
      interviewRunId: firstAnswerAttempt.logicalRun.id,
      agentRunId: firstAnswerAttempt.agentRun.id,
      attemptGeneration: firstAnswerAttempt.logicalRun.attemptGeneration,
      leaseOwner: answerOwner1,
      errorCode: "ANSWER_TEST_FAILURE",
    }), true);
    assert.equal((await retryInterviewRun({
      database,
      userId,
      interviewId: created.interviewId,
      interviewRunId: firstAnswerAttempt.logicalRun.id,
    })).state, "ready");

    const answerOwner2 = randomUUID();
    const retriedAnswerAttempt = await claimInterviewTurnRun({
      database,
      userId,
      interviewRunId: answered.run.id,
      leaseOwner: answerOwner2,
      buildModelMessage: () => ({ role: "user", content: "answer retry context" }),
    });
    assert.equal(retriedAnswerAttempt.state, "claimed");
    if (retriedAnswerAttempt.state !== "claimed") return;
    const followUp = await commitInterviewAgentAction({
      userId,
      sessionId: retriedAnswerAttempt.session.id,
      agentRunId: retriedAnswerAttempt.agentRun.id,
      interviewId: retriedAnswerAttempt.interview.id,
      interviewRunId: retriedAnswerAttempt.logicalRun.id,
      attemptGeneration: retriedAnswerAttempt.logicalRun.attemptGeneration,
      leaseOwner: answerOwner2,
      action: {
        answerAnalysis: {
          completeness: "high",
          specificity: "high",
          evidenceStrength: "medium",
          reflectionDepth: "medium",
          followUpNeeded: true,
          missingPoints: ["恢复边界"],
          extractedEvidence: ["持久化事件和 fenced lease"],
        },
        action: {
          type: "ask_question",
          kind: "follow_up",
          question: "你会如何定义恢复边界？",
          topic: "Agent 项目",
          resumeEvidenceIds: [evidenceId],
        },
      },
    }, { database });
    assert.equal("completed" in followUp, false);
    if ("completed" in followUp) return;

    const skipped = await submitInterviewAnswer({
      userId,
      interviewId: created.interviewId,
      idempotencyKey: "recovery-skip",
      request: { questionId: followUp.id, skipped: true },
    }, { database });
    const skipOwner = randomUUID();
    const skipAttempt = await claimInterviewTurnRun({
      database,
      userId,
      interviewRunId: skipped.run.id,
      leaseOwner: skipOwner,
      buildModelMessage: () => ({ role: "user", content: "skip context" }),
    });
    assert.equal(skipAttempt.state, "claimed");
    if (skipAttempt.state !== "claimed") return;
    assert.equal(await failInterviewTurnRun({
      database,
      interviewRunId: skipAttempt.logicalRun.id,
      agentRunId: skipAttempt.agentRun.id,
      attemptGeneration: skipAttempt.logicalRun.attemptGeneration,
      leaseOwner: skipOwner,
      errorCode: "SKIP_TEST_FAILURE",
    }), true);
    assert.equal((await retryInterviewRun({
      database,
      userId,
      interviewId: created.interviewId,
      interviewRunId: skipAttempt.logicalRun.id,
    })).state, "ready");
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, userId));
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});
