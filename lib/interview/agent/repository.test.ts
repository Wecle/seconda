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
  assert.equal((await repository.claimRun(run.id, "worker-a", new Date(now.getTime() + 1_000), 30_000)).claimed, false);
  assert.equal((await repository.claimRun(run.id, "worker-b", new Date(now.getTime() + 10_000), 30_000)).claimed, false);
  assert.equal((await repository.claimRun(run.id, "worker-b", new Date(now.getTime() + 31_000), 30_000)).claimed, true);
  assert.equal((await repository.getRun(run.id))?.resumeCount, 1);
});

test("reopens a retryable failed run with its durable trigger and checkpoint", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "failed-recovery" });
  await repository.saveRunTrigger(run.id, { mode: "answer", instruction: "continue accepted answer" });
  await repository.saveCheckpoint(run.id, {
    turnCount: 2,
    toolCallCount: 1,
    lastEventSequence: 0,
    progressHash: "durable",
    activeSkillNames: [],
  });
  await repository.terminateRun(run.id, { exitReason: "aborted_streaming" });
  const failed = await repository.getRun(run.id);
  assert.ok(failed?.nextResumeAt);
  const claimed = await repository.claimRun(run.id, "recovery-worker", failed.nextResumeAt, 30_000);
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.run?.status, "running");
  assert.equal(claimed.run?.resumeCount, 1);
  assert.equal(claimed.run?.trigger?.instruction, "continue accepted answer");
  assert.equal(claimed.run?.checkpoint?.progressHash, "durable");
});

test("exhausts Agent recovery after two resumed executions", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "bounded-recovery" });
  await repository.saveRunTrigger(run.id, { mode: "answer", instruction: "continue" });
  await repository.terminateRun(run.id, { exitReason: "provider_failed" });
  for (let resume = 1; resume <= 2; resume += 1) {
    const failed = await repository.getRun(run.id);
    assert.ok(failed?.nextResumeAt);
    const claimed = await repository.claimRun(run.id, `worker-${resume}`, failed.nextResumeAt, 30_000);
    assert.equal(claimed.claimed, true);
    await repository.terminateRun(run.id, { exitReason: "provider_failed" }, {
      owner: `worker-${resume}`,
      generation: claimed.run!.leaseGeneration,
    });
  }
  const exhausted = await repository.getRun(run.id);
  assert.equal(exhausted?.resumeCount, 2);
  assert.equal(exhausted?.nextResumeAt, null);
  assert.equal((await repository.claimRun(run.id, "late", new Date(8640000000000000), 30_000)).claimed, false);
});

test("renews and releases leases only for their owner", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview-1", idempotencyKey: "run" });
  const now = new Date("2026-07-11T00:00:00.000Z");
  const claim = await repository.claimRun(run.id, "worker-a", now, 30_000);
  const generation = claim.run!.leaseGeneration;
  assert.equal(await repository.renewLease(run.id, { owner: "worker-b", generation }, now, 30_000), false);
  assert.equal(await repository.renewLease(run.id, { owner: "worker-a", generation }, now, 30_000), true);
  assert.equal(await repository.releaseLease(run.id, { owner: "worker-b", generation }), false);
  assert.equal(await repository.releaseLease(run.id, { owner: "worker-a", generation }), true);
});

test("rejects every write from a stale lease generation after takeover", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "fencing" });
  const first = await repository.claimRun(run.id, "worker-a", new Date(0), 1_000);
  const second = await repository.claimRun(run.id, "worker-b", new Date(2_000), 1_000);
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, true);
  const staleLease = {
    owner: "worker-a",
    generation: first.run!.leaseGeneration,
  };
  await assert.rejects(
    repository.appendEvent(run.id, { type: "warning", payload: {} }, staleLease),
    /lease/i,
  );
  await assert.rejects(
    repository.saveCheckpoint(run.id, {
      turnCount: 1,
      toolCallCount: 1,
      lastEventSequence: 0,
      progressHash: "stale",
      activeSkillNames: [],
    }, staleLease),
    /lease/i,
  );
  await assert.rejects(
    repository.terminateRun(run.id, { exitReason: "completed" }, staleLease),
    /lease/i,
  );
  await assert.rejects(
    repository.commitQuestionOutcome({
      runId: run.id,
      interviewId: "interview",
      toolCallId: "stale-question",
      lease: staleLease,
      category: "technical_depth",
      topic: "cache",
      question: "如何保证缓存一致性？",
      responseText: "请说明如何保证缓存一致性？",
      resumeEvidenceIds: ["project:cache"],
    }),
    /lease/i,
  );
});

test("commits a question, category count and assistant message as one idempotent outcome", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "atomic" });
  const claim = await repository.claimRun(run.id, "worker", new Date(0), 30_000);
  const input = {
    runId: run.id,
    interviewId: "interview",
    toolCallId: "tool-call-1",
    lease: {
      owner: "worker",
      generation: claim.run!.leaseGeneration,
    },
    category: "technical_depth",
    topic: "cache",
    question: "如何保证缓存一致性？",
    responseText: "请说明如何保证缓存一致性？",
    resumeEvidenceIds: ["project:cache"],
    targetRole: {
      value: "后端工程师",
      status: "inferred" as const,
      confidence: "high" as const,
      sourceIds: ["project:cache"],
    },
  };
  const commitQuestionOutcome = repository.commitQuestionOutcome;
  assert.equal(typeof commitQuestionOutcome, "function");
  const first = await commitQuestionOutcome.call(repository, input);
  const replay = await commitQuestionOutcome.call(repository, input);
  assert.deepEqual(replay, first);
  const snapshot = repository.inspectInterview("interview");
  assert.equal(snapshot.questions.length, 1);
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.categoryCounts.technical_depth, 1);
  assert.deepEqual(snapshot.targetRole, input.targetRole);
});

test("never commits a fourth question in one category under concurrent attempts or replay", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "category-limit" });
  const claim = await repository.claimRun(run.id, "worker", new Date(0), 30_000);
  const lease = { owner: "worker", generation: claim.run!.leaseGeneration };
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => (
    repository.commitQuestionOutcome({
      runId: run.id,
      interviewId: "interview",
      toolCallId: `question-${index}`,
      lease,
      category: "technical_depth",
      topic: index === 0 ? "cache" : "cache-follow-up",
      question: `问题 ${index + 1}？`,
      responseText: `问题 ${index + 1}？`,
      resumeEvidenceIds: ["project:cache"],
    })
  )));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const first = await repository.commitQuestionOutcome({
    runId: run.id,
    interviewId: "interview",
    toolCallId: "question-0",
    lease,
    category: "technical_depth",
    topic: "cache",
    question: "问题 1？",
    responseText: "问题 1？",
    resumeEvidenceIds: ["project:cache"],
  });
  assert.equal(first.questionId, (results[0] as PromiseFulfilledResult<typeof first>).value.questionId);
  assert.equal(repository.inspectInterview("interview").categoryCounts.technical_depth, 3);
});
