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

test("commits one completed terminal event", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const first = await repository.terminateRun(run.id, { exitReason: "completed" });
  const second = await repository.terminateRun(run.id, { exitReason: "completed" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual((await repository.listEvents(run.id, 0)).map((event) => event.type), ["run_completed"]);
});

test("persists run_failed before exposing failed status", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  await repository.terminateRun(run.id, {
    exitReason: "blocking_limit",
    error: new Error("no progress"),
    retryable: false,
    userMessage: "本轮处理未能继续，请重试。",
  });
  const events = await repository.listEvents(run.id, 0);
  assert.equal(events.at(-1)?.type, "run_failed");
  assert.equal((await repository.getRun(run.id))?.status, "failed");
});

test("uses the precise terminal action failure message", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "terminal-failure" });
  await repository.terminateRun(run.id, {
    exitReason: "terminal_action_failed",
    error: new Error("invalid terminal action"),
  });
  const event = (await repository.listEvents(run.id, 0)).at(-1);
  assert.equal(event?.type, "run_failed");
  assert.equal(
    (event?.payload as { userMessage?: string }).userMessage,
    "本轮问题生成未能通过运行规则，请重试。",
  );
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

test("replays only events after the supplied cursor", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "run" });
  await repository.appendEvent(run.id, { type: "run_started", payload: { value: 1 } });
  await repository.appendEvent(run.id, { type: "model_started", payload: { value: 2 } });
  await repository.appendEvent(run.id, { type: "warning", payload: { value: 3 } });
  assert.deepEqual((await repository.listEvents(run.id, 1)).map((event) => event.sequence), [2, 3]);
});

test("allows one lease owner and supports stale takeover", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "run" });
  const now = new Date("2026-07-11T00:00:00.000Z");
  assert.equal((await repository.claimRun(run.id, "worker-a", now, 30_000)).claimed, true);
  assert.equal((await repository.claimRun(run.id, "worker-b", new Date(now.getTime() + 10_000), 30_000)).claimed, false);
  assert.equal((await repository.claimRun(run.id, "worker-b", new Date(now.getTime() + 31_000), 30_000)).claimed, true);
  assert.equal((await repository.getRun(run.id))?.resumeCount, 1);
});

test("renews and releases leases only for their owner", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "run" });
  const now = new Date("2026-07-11T00:00:00.000Z");
  await repository.claimRun(run.id, "worker-a", now, 30_000);
  assert.equal(await repository.renewLease(run.id, "worker-b", now, 30_000), false);
  assert.equal(await repository.renewLease(run.id, "worker-a", now, 30_000), true);
  assert.equal(await repository.releaseLease(run.id, "worker-b"), false);
  assert.equal(await repository.releaseLease(run.id, "worker-a"), true);
});
