import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  agentEvents,
  agentRuns,
  agentSessions,
  interviewAgentRuns,
  interviewQuestions,
  interviews,
  users,
} from "@/lib/db/schema";

const databaseUrl = process.env.DATABASE_URL;

test("room query restores committed state for its owner and hides it from other users", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const [{ getInterviewRoom }, { loadOwnedOpeningRunReference }] = await Promise.all([
    import("./application/get-interview-room"),
    import("./persistence/repository"),
  ]);
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  await database.insert(users).values([
    { id: ownerId, email: `${ownerId}@example.test` },
    { id: outsiderId, email: `${outsiderId}@example.test` },
  ]);
  try {
    const [session] = await database.insert(agentSessions).values({
      userId: ownerId,
      title: "Room recovery",
      model: "test/model",
      capability: "interview",
      promptVersion: "interview-agent-v1",
      systemPrompt: "Interview contract",
      workspaceRoot: null,
    }).returning();
    const [interview] = await database.insert(interviews).values({
      userId: ownerId,
      creationIdempotencyKey: "room-recovery",
      creationRequestHash: "room-recovery-hash",
      agentSessionId: session.id,
      resumeVersionId: randomUUID(),
      status: "active",
      language: "zh",
      persona: "standard",
      interviewType: "mixed",
      targetLevel: "Senior",
      targetRole: "Platform Engineer",
      targetRoundCount: 5,
      startedAt: new Date(),
    }).returning();
    const [agentRun] = await database.insert(agentRuns).values({
      sessionId: session.id,
      status: "completed",
      maxSteps: 3,
      startedAt: new Date(),
      completedAt: new Date(),
    }).returning();
    const [logicalRun] = await database.insert(interviewAgentRuns).values({
      interviewId: interview.id,
      currentAgentRunId: agentRun.id,
      triggerType: "opening",
      triggerKey: "opening",
      status: "completed",
      completedAt: new Date(),
    }).returning();
    const [question] = await database.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: logicalRun.id,
      sequence: 1,
      kind: "main",
      topic: "系统设计",
      question: "请介绍你做过的事件驱动系统。",
      tip: "说明关键取舍",
    }).returning();
    await database.insert(agentEvents).values([
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 1,
        type: "interview/session_initialized",
        payload: { interviewId: interview.id, openingRunId: logicalRun.id, status: "initializing" },
        schemaVersion: 1,
        visibility: "model_and_user",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 2,
        type: "step_started",
        payload: { step: 1, attempt: 1 },
        schemaVersion: 1,
        visibility: "model",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 3,
        type: "assistant_chunk",
        payload: { chunk: { type: "block-start", index: 0, blockType: "reasoning" } },
        schemaVersion: 1,
        visibility: "model",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 4,
        type: "assistant_chunk",
        payload: { chunk: { type: "reasoning-delta", index: 0, text: "基于候选人的项目经历生成问题。" } },
        schemaVersion: 1,
        visibility: "model",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 5,
        type: "assistant_chunk",
        payload: { chunk: { type: "block-end", index: 0, blockType: "reasoning" } },
        schemaVersion: 1,
        visibility: "model",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 6,
        type: "interview/question_committed",
        payload: {
          interviewId: interview.id,
          questionId: question.id,
          sequence: 1,
          kind: "main",
          topic: "系统设计",
          question: "请介绍你做过的事件驱动系统。",
          tip: "说明关键取舍",
          resumeEvidenceIds: [],
        },
        schemaVersion: 1,
        visibility: "model_and_user",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 7,
        type: "assistant_message",
        payload: { raw: "not public" },
        schemaVersion: 1,
        visibility: "model",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 8,
        type: "assistant_chunk",
        payload: { chunk: { type: "reasoning-delta", index: 0, text: "internal payload" } },
        schemaVersion: 1,
        visibility: "internal",
      },
      {
        sessionId: session.id,
        runId: agentRun.id,
        sequence: 9,
        type: "assistant_chunk",
        payload: { chunk: { type: "reasoning-delta", index: 0, text: "future schema" } },
        schemaVersion: 2,
        visibility: "model",
      },
    ]);

    const owned = await getInterviewRoom({ userId: ownerId, interviewId: interview.id }, { database });
    assert.equal(owned?.room.phase, "awaiting_answer");
    assert.equal(owned?.room.currentQuestion?.id, question.id);
    assert.equal(owned?.room.currentQuestion?.content, "请介绍你做过的事件驱动系统。");
    assert.equal(owned?.transcript.length, 2);
    assert.deepEqual(owned?.transcript.map((item) => item.type), ["reasoning", "question"]);
    assert.equal(owned?.transcript[0].content, "基于候选人的项目经历生成问题。");

    const hidden = await getInterviewRoom({ userId: outsiderId, interviewId: interview.id }, { database });
    assert.equal(hidden, null);
    assert.deepEqual(await loadOwnedOpeningRunReference({
      database,
      userId: ownerId,
      interviewId: interview.id,
    }), { openingRunId: logicalRun.id });
    assert.equal(await loadOwnedOpeningRunReference({
      database,
      userId: outsiderId,
      interviewId: interview.id,
    }), null);

    await database.update(interviewQuestions).set({ status: "answered" })
      .where(eq(interviewQuestions.id, question.id));
    let recordedInvalidState: { interviewId: string; questionId: string | null } | null = null;
    const invalid = await getInterviewRoom({ userId: ownerId, interviewId: interview.id }, {
      database,
      recordInvalidState: (details) => {
        recordedInvalidState = details;
      },
    });
    assert.equal(invalid?.room.phase, "invalid_state");
    assert.deepEqual(recordedInvalidState, {
      interviewId: interview.id,
      interviewStatus: "active",
      questionId: null,
      questionStatus: null,
      runId: logicalRun.id,
      runStatus: "completed",
    });
    await database.update(interviewQuestions).set({ status: "awaiting_answer" })
      .where(eq(interviewQuestions.id, question.id));

    const [foreignSession] = await database.insert(agentSessions).values({
      userId: outsiderId,
      title: "Foreign session",
      model: "test/model",
      capability: "interview",
      promptVersion: "interview-agent-v1",
      systemPrompt: "Foreign interview contract",
      workspaceRoot: null,
    }).returning();
    await database.update(interviews).set({ agentSessionId: foreignSession.id })
      .where(eq(interviews.id, interview.id));
    const mismatched = await getInterviewRoom({ userId: ownerId, interviewId: interview.id }, { database });
    assert.equal(mismatched, null);
  } finally {
    await database.delete(interviews).where(eq(interviews.userId, ownerId));
    await database.delete(users).where(eq(users.id, outsiderId));
    await database.delete(users).where(eq(users.id, ownerId));
    await client.end();
  }
});
