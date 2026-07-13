import assert from "node:assert/strict";
import test from "node:test";
import { getRecoveryDisposition } from "./worker";
import {
  createInMemoryInterviewAgentRepository,
  type AgentRunRecord,
} from "./repository";

const base: AgentRunRecord = {
  id: "run",
  interviewId: "interview",
  status: "running",
  attemptId: null,
  provisionalMessageId: null,
  exitReason: null,
  leaseOwner: null,
  leaseExpiresAt: null,
  leaseGeneration: 0,
  resumeCount: 0,
  nextResumeAt: null,
  checkpoint: null,
  trigger: { mode: "answer", instruction: "continue" },
  lastEventSequence: 0,
};

test("reports a live lease as already running", () => {
  assert.equal(getRecoveryDisposition({
    ...base,
    leaseOwner: "worker",
    leaseExpiresAt: new Date("2026-07-11T00:01:00.000Z"),
  }, new Date("2026-07-11T00:00:00.000Z")), "already_running");
});

test("schedules unleased and stale runs", () => {
  assert.equal(getRecoveryDisposition(base, new Date()), "schedule");
  assert.equal(getRecoveryDisposition({
    ...base,
    leaseOwner: "old",
    leaseExpiresAt: new Date("2026-07-10T23:59:00.000Z"),
  }, new Date("2026-07-11T00:00:00.000Z")), "schedule");
});

test("returns terminal run status without scheduling", () => {
  assert.equal(getRecoveryDisposition({ ...base, status: "completed" }, new Date()), "completed");
  assert.equal(getRecoveryDisposition({ ...base, status: "failed" }, new Date()), "failed");
});

test("schedules a retryable failed answer run without accepting the answer again", () => {
  assert.equal(getRecoveryDisposition({
    ...base,
    status: "failed",
    exitReason: "aborted_streaming",
    trigger: { mode: "answer", instruction: "continue from accepted answer" },
  }, new Date()), "schedule");
});

test("enforces cooldown and a bounded recovery budget", () => {
  const now = new Date("2026-07-11T00:00:00.000Z");
  assert.equal(getRecoveryDisposition({
    ...base,
    status: "failed",
    exitReason: "provider_failed",
    nextResumeAt: new Date("2026-07-11T00:00:30.000Z"),
  }, now), "cooldown");
  assert.equal(getRecoveryDisposition({
    ...base,
    status: "failed",
    exitReason: "provider_failed",
    resumeCount: 2,
  }, now), "exhausted");
});

test("keeps the queryable run phase aligned with recovery checkpoints", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const created = await repository.createRun({
    interviewId: "interview",
    idempotencyKey: "phase-recovery",
  });
  const claimed = await repository.claimRun(created.id, "worker", new Date(), 60_000);
  const lease = {
    owner: "worker",
    generation: claimed.run!.leaseGeneration,
  };
  await repository.startAttempt(created.id, {
    model: "fake",
    attemptId: "attempt-1",
    attemptNumber: 1,
    provisionalMessageId: "message-1",
    now: new Date(),
  }, lease);
  await repository.saveCheckpoint(created.id, {
    turnCount: 1,
    toolCallCount: 0,
    lastEventSequence: 0,
    progressHash: "recoverable",
    activeSkillNames: [],
    runtimeMessages: [{ role: "user", content: "continue" }],
    phase: "repairing",
  }, lease);

  const persisted = await repository.getRun(created.id);
  assert.equal(persisted?.phase, "repairing");
  assert.equal(persisted?.checkpoint?.phase, "repairing");
  assert.equal(persisted?.attemptId, "attempt-1");
  assert.equal(persisted?.provisionalMessageId, "message-1");
});
