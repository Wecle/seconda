import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "./repository";

test("allocates monotonic event and message sequences", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({
    interviewId: "interview-1",
    idempotencyKey: "run-key",
  });

  assert.equal((await repository.appendEvent(run.id, { type: "run_started", payload: {} })).sequence, 1);
  assert.equal((await repository.appendEvent(run.id, { type: "model_started", payload: {} })).sequence, 2);
  assert.equal((await repository.appendMessage({
    interviewId: "interview-1",
    runId: run.id,
    role: "user",
    kind: "answer",
    content: "answer",
    idempotencyKey: "message-key-1",
  })).sequence, 1);
  assert.equal((await repository.appendMessage({
    interviewId: "interview-1",
    runId: run.id,
    role: "assistant",
    kind: "question",
    content: "question",
  })).sequence, 2);
});

test("reuses runs and messages for duplicate idempotency keys", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const firstRun = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "same" });
  const secondRun = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "same" });
  assert.equal(secondRun.id, firstRun.id);

  const input = {
    interviewId: "interview-1",
    runId: firstRun.id,
    role: "user" as const,
    kind: "answer" as const,
    content: "answer",
    idempotencyKey: "same-message",
  };
  const firstMessage = await repository.appendMessage(input);
  const secondMessage = await repository.appendMessage(input);
  assert.deepEqual(secondMessage, firstMessage);
});

test("allows only one terminal transition", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "run" });
  await repository.completeRun(run.id, "completed");
  await assert.rejects(repository.failRun(run.id, "aborted_tools", new Error("late")), /already terminal/);
});

test("persists and reloads checkpoints and interview state", async () => {
  const repository = createInMemoryInterviewAgentRepository({
    interviewId: "interview-1",
    candidateRoundCount: 3,
    categoryCounts: { introduction: 1 },
    recentQuestions: ["请自我介绍"],
    requestedUserEnd: false,
  });
  const run = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "run" });
  await repository.saveCheckpoint(run.id, {
    turnCount: 1,
    toolCallCount: 2,
    lastEventSequence: 3,
    progressHash: "progress",
    activeSkillNames: [],
  });

  assert.equal((await repository.loadState("interview-1")).candidateRoundCount, 3);
  assert.equal(repository.inspectRun(run.id)?.checkpoint?.progressHash, "progress");
});
