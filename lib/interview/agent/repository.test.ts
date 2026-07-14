import assert from "node:assert/strict";
import test from "node:test";
import type { AnswerAssessment } from "./contracts";
import {
  createInMemoryInterviewAgentRepository,
  type CommitTurnOutcomeInput,
  type RunLeaseToken,
} from "./repository";
import { hashTurnProposalPrefix, type TurnProposalPrefix } from "./turn-proposal";

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

test("replays only explicitly public events for SSE", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "visibility" });
  await repository.appendEvent(run.id, {
    type: "checkpoint",
    visibility: "internal",
    attemptId: null,
    logicalMessageId: null,
    payload: {},
  });
  await repository.appendEvent(run.id, {
    type: "reasoning_delta",
    visibility: "public",
    attemptId: "a1",
    logicalMessageId: "m1",
    payload: {
      runId: run.id,
      attemptId: "a1",
      entryId: "reasoning:a1",
      text: "公开",
    },
  });

  const events = await repository.listEvents(run.id, 0, { visibility: "public" });

  assert.deepEqual(events.map((event) => event.type), ["reasoning_delta"]);
});

test("archives a stale public terminal before publishing a new terminal", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "terminal-retry" });
  await repository.appendEvent(run.id, {
    type: "run_failed",
    visibility: "public",
    payload: {
      runId: run.id,
      exitReason: "aborted_streaming",
      retryable: true,
      userMessage: "old failure",
    },
  });

  await repository.terminateRun(run.id, { exitReason: "completed" });

  const terminals = (await repository.listEvents(run.id, 0))
    .filter((event) => event.type === "run_completed" || event.type === "run_failed");
  assert.deepEqual(terminals.map((event) => ({
    type: event.type,
    visibility: event.visibility,
  })), [
    { type: "run_failed", visibility: "internal" },
    { type: "run_completed", visibility: "public" },
  ]);
});

test("materializes a complete stable envelope for in-memory events", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "envelope" });
  await repository.appendEvent(run.id, { type: "checkpoint", payload: { progress: 1 } });

  const [first] = await repository.listEvents(run.id, 0);
  const [replayed] = await repository.listEvents(run.id, 0);

  assert.equal(first.id, replayed.id);
  assert.equal(first.runId, run.id);
  assert.equal(first.visibility, "internal");
  assert.equal(first.attemptId, null);
  assert.equal(first.logicalMessageId, null);
  assert.equal(new Date(first.createdAt).toISOString(), first.createdAt);
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

function answerAssessment(overrides: Partial<AnswerAssessment> = {}): AnswerAssessment {
  return {
    completeness: "high" as const,
    specificity: "high" as const,
    evidenceStrength: "strong" as const,
    reflectionDepth: "surface" as const,
    followUpNeeded: true,
    missingPoints: ["一致性边界"],
    extractedEvidence: ["使用租约与幂等键"],
    publicSummary: "回答包含可靠性机制，但仍需验证一致性边界。",
    ...overrides,
  };
}

function nextQuestionProposal(
  overrides: Partial<TurnProposalPrefix> = {},
): TurnProposalPrefix {
  return {
    assessment: answerAssessment(),
    coverageChanges: [{
      category: "technical_depth",
      topic: "可靠性机制",
      status: "partial",
      resumeEvidenceIds: ["project:seconda"],
    }],
    decision: {
      action: "ask",
      category: "resume_project",
      intent: "new_topic",
      evidenceIds: ["project:seconda"],
      coverageTarget: "验证项目中的一致性设计",
      estimatedInformationGain: "high",
    },
    ...overrides,
  };
}

async function createAnsweredTurnFixture() {
  const repository = createInMemoryInterviewAgentRepository({
    interviewId: "atomic-interview",
    candidateRoundCount: 1,
    categoryCounts: {},
    categoryStatuses: {},
    recentQuestions: [],
    requestedUserEnd: false,
    consecutiveNoFollowUpAssessments: 0,
  });
  const run = await repository.createRun({
    interviewId: "atomic-interview",
    idempotencyKey: "atomic-turn",
  });
  const claimed = await repository.claimRun(run.id, "atomic-worker", new Date(0), 60_000);
  const lease: RunLeaseToken = {
    owner: "atomic-worker",
    generation: claimed.run!.leaseGeneration,
  };
  const asked = await repository.commitQuestionOutcome({
    runId: run.id,
    interviewId: "atomic-interview",
    toolCallId: "seed-question",
    lease,
    category: "technical_depth",
    topic: "可靠性",
    question: "你如何保证服务可靠性？",
    responseText: "你如何保证服务可靠性？",
    resumeEvidenceIds: ["project:seconda"],
  });
  const answer = await repository.appendMessage({
    interviewId: "atomic-interview",
    runId: run.id,
    role: "user",
    kind: "answer",
    content: "我使用租约与幂等键。",
    questionId: asked.questionId,
  });
  const attemptId = "attempt-1";
  const logicalMessageId = "logical-message-1";
  await repository.startAttempt(run.id, {
    model: "test-model",
    attemptId,
    attemptNumber: 1,
    provisionalMessageId: logicalMessageId,
    now: new Date(1),
  }, lease);
  const proposal = nextQuestionProposal();
  const proposalHash = hashTurnProposalPrefix(proposal);
  await repository.authorizeProposal({
    runId: run.id,
    lease,
    attemptId,
    logicalMessageId,
    proposal,
    proposalHash,
    checkpoint: {
      turnCount: 1,
      toolCallCount: 1,
      lastEventSequence: 0,
      progressHash: "authorized",
      activeSkillNames: [],
    },
  });
  await repository.markResponseStarted({
    runId: run.id,
    lease,
    attemptId,
    logicalMessageId,
    proposalHash,
  });
  await repository.saveCheckpoint(run.id, {
    turnCount: 1,
    toolCallCount: 1,
    lastEventSequence: 0,
    progressHash: "committing",
    activeSkillNames: [],
    phase: "committing",
  }, lease);
  const input: CommitTurnOutcomeInput = {
    runId: run.id,
    interviewId: "atomic-interview",
    toolCallId: "submit-1",
    lease,
    logicalMessageId,
    attemptId,
    answerMessageId: answer.id,
    proposal,
    proposalHash,
    responseText: "你在项目中如何验证租约失效后的数据一致性？",
    language: "zh",
  };
  return { repository, run, lease, input };
}

async function prepareFixtureAttempt(
  fixture: Awaited<ReturnType<typeof createAnsweredTurnFixture>>,
  proposal: TurnProposalPrefix,
  input: { attemptId: string; logicalMessageId: string; attemptNumber?: number },
) {
  const proposalHash = hashTurnProposalPrefix(proposal);
  await fixture.repository.startAttempt(fixture.run.id, {
    model: "test-model",
    attemptId: input.attemptId,
    attemptNumber: input.attemptNumber ?? 2,
    provisionalMessageId: input.logicalMessageId,
    now: new Date(input.attemptNumber ?? 2),
  }, fixture.lease);
  await fixture.repository.authorizeProposal({
    runId: fixture.run.id,
    lease: fixture.lease,
    attemptId: input.attemptId,
    logicalMessageId: input.logicalMessageId,
    proposal,
    proposalHash,
    checkpoint: {
      turnCount: 1,
      toolCallCount: 1,
      lastEventSequence: 0,
      progressHash: input.attemptId,
      activeSkillNames: [],
    },
  });
  await fixture.repository.markResponseStarted({
    runId: fixture.run.id,
    lease: fixture.lease,
    attemptId: input.attemptId,
    logicalMessageId: input.logicalMessageId,
    proposalHash,
  });
  await fixture.repository.saveCheckpoint(fixture.run.id, {
    turnCount: 1,
    toolCallCount: 1,
    lastEventSequence: 0,
    progressHash: `${input.attemptId}:committing`,
    activeSkillNames: [],
    phase: "committing",
  }, fixture.lease);
  return { proposalHash };
}

test("commits assessment coverage message and committed event once", async () => {
  const fixture = await createAnsweredTurnFixture();
  const [first, replay] = await Promise.all([
    fixture.repository.commitTurnOutcome(fixture.input),
    fixture.repository.commitTurnOutcome(fixture.input),
  ]);

  assert.equal(replay.messageId, first.messageId);
  assert.equal(first.messageId, fixture.input.logicalMessageId);
  const snapshot = fixture.repository.inspectInterview(fixture.input.interviewId);
  assert.equal(snapshot.assessments.length, 1);
  assert.equal(snapshot.questions.length, 2);
  assert.equal(snapshot.messageCommittedEvents.length, 1);
  assert.equal(snapshot.submitTurnCommits.length, 1);
  assert.equal(snapshot.coverage.find((item) => (
    item.category === "technical_depth" && item.topic === "__category__"
  ))?.lastAssessmentId, snapshot.assessments[0].id);
  assert.equal(snapshot.messageCommittedEvents[0].attemptId, fixture.input.attemptId);
  assert.deepEqual(
    (snapshot.messageCommittedEvents[0].payload as { message: unknown }).message,
    first.message,
  );
});

test("rejects an answer from another run without turn writes", async () => {
  const fixture = await createAnsweredTurnFixture();
  const snapshot = fixture.repository.inspectInterview(fixture.input.interviewId);
  const answer = snapshot.messages.find((message) => message.id === fixture.input.answerMessageId)!;
  answer.runId = "run-other";

  await assert.rejects(
    fixture.repository.commitTurnOutcome(fixture.input),
    /does not belong/i,
  );

  assert.equal(snapshot.assessments.length, 0);
  assert.equal(snapshot.questions.length, 1);
  assert.equal(snapshot.messageCommittedEvents.length, 0);
  assert.equal(snapshot.submitTurnCommits.length, 0);
});

test("rejects a memory run committed through another interview id without writes", async () => {
  const fixture = await createAnsweredTurnFixture();

  await assert.rejects(
    fixture.repository.commitTurnOutcome({
      ...fixture.input,
      interviewId: "another-interview",
    }),
    /run does not belong to interview/i,
  );

  const snapshot = fixture.repository.inspectInterview(fixture.input.interviewId);
  assert.equal(snapshot.assessments.length, 0);
  assert.equal(snapshot.questions.length, 1);
  assert.equal(snapshot.messageCommittedEvents.length, 0);
  assert.equal(snapshot.submitTurnCommits.length, 0);
});

test("rejects committed-tool replay from a stale attempt or lease", async () => {
  const staleAttemptFixture = await createAnsweredTurnFixture();
  await staleAttemptFixture.repository.commitTurnOutcome(staleAttemptFixture.input);
  await staleAttemptFixture.repository.startAttempt(staleAttemptFixture.run.id, {
    model: "test-model",
    attemptId: "attempt-2",
    attemptNumber: 2,
    provisionalMessageId: "logical-message-2",
    now: new Date(2),
  }, staleAttemptFixture.lease);
  await assert.rejects(
    staleAttemptFixture.repository.commitTurnOutcome(staleAttemptFixture.input),
    /attempt is stale/i,
  );

  const staleLeaseFixture = await createAnsweredTurnFixture();
  await staleLeaseFixture.repository.commitTurnOutcome(staleLeaseFixture.input);
  const takeover = await staleLeaseFixture.repository.claimRun(
    staleLeaseFixture.run.id,
    "new-worker",
    new Date(61_000),
    60_000,
  );
  assert.equal(takeover.claimed, true);
  await assert.rejects(
    staleLeaseFixture.repository.commitTurnOutcome(staleLeaseFixture.input),
    /lease is stale/i,
  );
});

test("normalizes the authoritative response text before committing", async () => {
  const fixture = await createAnsweredTurnFixture();
  const outcome = await fixture.repository.commitTurnOutcome({
    ...fixture.input,
    responseText: `  ${fixture.input.responseText}  `,
  });

  assert.equal(outcome.responseText, fixture.input.responseText);
  assert.equal(outcome.message.content, fixture.input.responseText);
  assert.equal(
    fixture.repository.inspectInterview(fixture.input.interviewId).questions.at(-1)?.question,
    fixture.input.responseText,
  );
});

test("rejects blank and oversized finish responses without domain writes", async () => {
  const fixture = await createAnsweredTurnFixture();
  const finishProposal: TurnProposalPrefix = {
    assessment: answerAssessment(),
    coverageChanges: [{
      category: "technical_depth",
      topic: "可靠性机制",
      status: "partial",
      resumeEvidenceIds: ["project:seconda"],
    }],
    decision: {
      action: "finish",
      completionReason: "coverage_sufficient",
    },
  };
  const { proposalHash } = await prepareFixtureAttempt(fixture, finishProposal, {
    attemptId: "attempt-finish-validation",
    logicalMessageId: "logical-finish-validation",
  });
  const invalidInput = {
    ...fixture.input,
    toolCallId: "submit-finish-validation",
    attemptId: "attempt-finish-validation",
    logicalMessageId: "logical-finish-validation",
    proposal: finishProposal,
    proposalHash,
  };

  await assert.rejects(
    fixture.repository.commitTurnOutcome({ ...invalidInput, responseText: "   " }),
  );
  await assert.rejects(
    fixture.repository.commitTurnOutcome({ ...invalidInput, responseText: "长".repeat(2_001) }),
  );
  const snapshot = fixture.repository.inspectInterview(fixture.input.interviewId);
  assert.equal(snapshot.assessments.length, 0);
  assert.equal(snapshot.questions.length, 1);
  assert.equal(snapshot.messageCommittedEvents.length, 0);
  assert.equal(snapshot.submitTurnCommits.length, 0);
});

test("returns a sufficient category to partial when asking another question", async () => {
  const fixture = await createAnsweredTurnFixture();
  const proposal = nextQuestionProposal({
    assessment: answerAssessment({ followUpNeeded: false }),
    coverageChanges: [{
      category: "technical_depth",
      topic: "可靠性机制",
      status: "sufficient",
      resumeEvidenceIds: ["project:seconda"],
    }],
    decision: {
      action: "ask",
      category: "technical_depth",
      intent: "follow_up",
      evidenceIds: ["project:seconda"],
      coverageTarget: "继续验证可靠性边界",
      estimatedInformationGain: "high",
    },
  });
  const { proposalHash } = await prepareFixtureAttempt(fixture, proposal, {
    attemptId: "attempt-sufficient",
    logicalMessageId: "logical-sufficient",
  });
  await fixture.repository.commitTurnOutcome({
    ...fixture.input,
    toolCallId: "submit-sufficient",
    attemptId: "attempt-sufficient",
    logicalMessageId: "logical-sufficient",
    proposal,
    proposalHash,
  });

  const aggregate = fixture.repository.inspectInterview(fixture.input.interviewId).coverage.find(
    (item) => item.category === "technical_depth" && item.topic === "__category__",
  );
  assert.equal(aggregate?.questionCount, 2);
  assert.equal(aggregate?.status, "partial");
});

test("rejects a non-authoritative interview language without domain writes", async () => {
  const fixture = await createAnsweredTurnFixture();
  await assert.rejects(fixture.repository.commitTurnOutcome({
    ...fixture.input,
    language: "en",
  }), /language/i);

  const snapshot = fixture.repository.inspectInterview(fixture.input.interviewId);
  assert.equal(snapshot.assessments.length, 0);
  assert.equal(snapshot.questions.length, 1);
  assert.equal(snapshot.messageCommittedEvents.length, 0);
});

test("a stale proposal hash leaves no partial turn writes", async () => {
  const fixture = await createAnsweredTurnFixture();
  await assert.rejects(fixture.repository.commitTurnOutcome({
    ...fixture.input,
    proposalHash: "0".repeat(64),
  }), /proposal hash/i);

  const snapshot = fixture.repository.inspectInterview(fixture.input.interviewId);
  assert.equal(snapshot.assessments.length, 0);
  assert.equal(snapshot.questions.length, 1);
  assert.equal(snapshot.messageCommittedEvents.length, 0);
  assert.equal(snapshot.submitTurnCommits.length, 0);
});

test("fences delayed callbacks from an older attempt under the same lease", async () => {
  const fixture = await createAnsweredTurnFixture();
  await fixture.repository.startAttempt(fixture.run.id, {
    model: "test-model",
    attemptId: "attempt-2",
    attemptNumber: 2,
    provisionalMessageId: "logical-message-2",
    now: new Date(2),
  }, fixture.lease);
  await assert.rejects(fixture.repository.startAttempt(fixture.run.id, {
    model: "test-model",
    attemptId: fixture.input.attemptId,
    attemptNumber: 1,
    provisionalMessageId: fixture.input.logicalMessageId,
    now: new Date(3),
  }, fixture.lease), /attempt is stale/i);

  await assert.rejects(
    fixture.repository.commitTurnOutcome(fixture.input),
    /attempt is stale/i,
  );
  await assert.rejects(fixture.repository.authorizeProposal({
    runId: fixture.run.id,
    lease: fixture.lease,
    attemptId: fixture.input.attemptId,
    logicalMessageId: fixture.input.logicalMessageId,
    proposal: fixture.input.proposal,
    proposalHash: fixture.input.proposalHash,
    checkpoint: {
      turnCount: 1,
      toolCallCount: 1,
      lastEventSequence: 0,
      progressHash: "stale",
      activeSkillNames: [],
    },
  }), /attempt is stale/i);

  const snapshot = fixture.repository.inspectInterview(fixture.input.interviewId);
  assert.equal(snapshot.assessments.length, 0);
  assert.equal(snapshot.messageCommittedEvents.length, 0);
});

test("rejects model writes to the reserved category aggregate before response starts", async () => {
  const fixture = await createAnsweredTurnFixture();
  const proposal = nextQuestionProposal({
    coverageChanges: [{
      category: "technical_depth",
      topic: "__category__",
      status: "partial",
      resumeEvidenceIds: ["project:seconda"],
    }],
  });
  const proposalHash = hashTurnProposalPrefix(proposal);
  await fixture.repository.startAttempt(fixture.run.id, {
    model: "test-model",
    attemptId: "attempt-reserved",
    attemptNumber: 2,
    provisionalMessageId: "logical-reserved",
    now: new Date(2),
  }, fixture.lease);
  await assert.rejects(fixture.repository.authorizeProposal({
    runId: fixture.run.id,
    lease: fixture.lease,
    attemptId: "attempt-reserved",
    logicalMessageId: "logical-reserved",
    proposal,
    proposalHash,
    checkpoint: {
      turnCount: 1,
      toolCallCount: 1,
      lastEventSequence: 0,
      progressHash: "reserved",
      activeSkillNames: [],
    },
  }), /reserved coverage topic/i);
  assert.equal(fixture.repository.inspectRun(fixture.run.id)?.responseStartedAt, null);
  assert.equal(
    fixture.repository.inspectInterview(fixture.input.interviewId).assessments.length,
    0,
  );
});
