import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "@/lib/interview/agent/persistence/memory-repository";
import { executeClaimedRun } from "@/lib/interview/agent/application/run-worker";

test("executes a persisted trigger once while a lease is active", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  await repository.saveRunTrigger(run.id, { mode: "answer", instruction: "continue" });
  let executions = 0;
  const executor = {
    async run() {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      await repository.completeRun(run.id, "completed");
      return { exitReason: "completed" as const };
    },
  };
  await Promise.all([
    executeClaimedRun({ runId: run.id, owner: "worker-a", repository, executor, leaseMs: 100, renewEveryMs: 20 }),
    executeClaimedRun({ runId: run.id, owner: "worker-b", repository, executor, leaseMs: 100, renewEveryMs: 20 }),
  ]);
  assert.equal(executions, 1);
});

test("does not execute terminal runs", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  await repository.completeRun(run.id, "completed");
  let executions = 0;
  const result = await executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    executor: { async run() { executions += 1; return { exitReason: "completed" }; } },
  });
  assert.equal(result.status, "not_claimed");
  assert.equal(executions, 0);
});

test("renews the lease during long execution", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  await repository.saveRunTrigger(run.id, { mode: "answer", instruction: "continue" });
  let renewals = 0;
  let markRenewed!: () => void;
  const renewed = new Promise<void>((resolve) => {
    markRenewed = resolve;
  });
  const originalRenew = repository.renewLease.bind(repository);
  repository.renewLease = async (...args) => {
    renewals += 1;
    markRenewed();
    return originalRenew(...args);
  };
  await executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    leaseMs: 50,
    renewEveryMs: 1,
    executor: {
      async run() {
        await renewed;
        await repository.completeRun(run.id, "completed");
        return { exitReason: "completed" };
      },
    },
  });
  assert.ok(renewals >= 1);
});

test("waits for an in-flight renewal before releasing the lease", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({
    interviewId: "interview",
    idempotencyKey: "renewal-shutdown",
  });
  await repository.saveRunTrigger(run.id, {
    mode: "answer",
    instruction: "continue",
  });
  let markRenewalStarted!: () => void;
  let releaseRenewal!: () => void;
  const renewalStarted = new Promise<void>((resolve) => {
    markRenewalStarted = resolve;
  });
  const renewalGate = new Promise<void>((resolve) => {
    releaseRenewal = resolve;
  });
  const originalRenew = repository.renewLease.bind(repository);
  repository.renewLease = async (...args) => {
    markRenewalStarted();
    await renewalGate;
    return originalRenew(...args);
  };
  let released = false;
  const originalRelease = repository.releaseLease.bind(repository);
  repository.releaseLease = async (...args) => {
    released = true;
    return originalRelease(...args);
  };

  const execution = executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    leaseMs: 50,
    renewEveryMs: 1,
    executor: {
      async run() {
        await renewalStarted;
        return { exitReason: "completed" };
      },
    },
  });

  await renewalStarted;
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    assert.equal(released, false);
  } finally {
    releaseRenewal();
  }
  await execution;
  assert.equal(released, true);
});

test("reports lease_lost when an in-flight renewal fails after the executor returns", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({
    interviewId: "interview",
    idempotencyKey: "late-lease-lost",
  });
  await repository.saveRunTrigger(run.id, {
    mode: "answer",
    instruction: "continue",
  });
  let markRenewalStarted!: () => void;
  let releaseRenewal!: () => void;
  const renewalStarted = new Promise<void>((resolve) => {
    markRenewalStarted = resolve;
  });
  const renewalGate = new Promise<void>((resolve) => {
    releaseRenewal = resolve;
  });
  repository.renewLease = async () => {
    markRenewalStarted();
    await renewalGate;
    return false;
  };

  const execution = executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    renewEveryMs: 1,
    executor: {
      async run() {
        await renewalStarted;
        return { exitReason: "completed" };
      },
    },
  });

  await renewalStarted;
  releaseRenewal();
  const result = await execution;

  assert.equal(result.status, "lease_lost");
  assert.equal((await repository.getRun(run.id))?.status, "running");
  assert.equal((await repository.getRun(run.id))?.leaseOwner, null);
});

test("keeps a persisted completion when an overlapping renewal reports lease loss", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({
    interviewId: "interview",
    idempotencyKey: "completed-before-lease-lost",
  });
  await repository.saveRunTrigger(run.id, {
    mode: "answer",
    instruction: "continue",
  });
  let markRenewalStarted!: () => void;
  let releaseRenewal!: () => void;
  let markCompletionPersisted!: () => void;
  const renewalStarted = new Promise<void>((resolve) => {
    markRenewalStarted = resolve;
  });
  const renewalGate = new Promise<void>((resolve) => {
    releaseRenewal = resolve;
  });
  const completionPersisted = new Promise<void>((resolve) => {
    markCompletionPersisted = resolve;
  });
  repository.renewLease = async () => {
    markRenewalStarted();
    await renewalGate;
    return false;
  };

  const execution = executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    renewEveryMs: 1,
    executor: {
      async run() {
        await renewalStarted;
        await repository.completeRun(run.id, "completed");
        markCompletionPersisted();
        return { exitReason: "completed" };
      },
    },
  });

  await completionPersisted;
  releaseRenewal();
  const result = await execution;

  assert.equal(result.status, "completed");
  assert.equal((await repository.getRun(run.id))?.status, "completed");
});

test("reports a lost lease once and leaves the run recoverable", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({
    interviewId: "interview",
    idempotencyKey: "lease-lost",
  });
  await repository.saveRunTrigger(run.id, {
    mode: "answer",
    instruction: "continue",
  });
  let renewals = 0;
  repository.renewLease = async () => {
    renewals += 1;
    return false;
  };
  let aborts = 0;

  const result = await executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    renewEveryMs: 1,
    executor: {
      async run(input) {
        await new Promise<void>((resolve) => {
          input.signal.addEventListener("abort", () => {
            aborts += 1;
            resolve();
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw input.signal.reason;
      },
    },
  });

  assert.equal(result.status, "lease_lost");
  assert.equal(renewals, 1);
  assert.equal(aborts, 1);
  assert.equal((await repository.getRun(run.id))?.status, "running");
  assert.equal((await repository.getRun(run.id))?.leaseOwner, null);
});

test("fails a running run that has no persisted trigger", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    executor: { async run() { throw new Error("must not execute"); } },
  });
  assert.equal(result.status, "failed");
  assert.equal((await repository.getRun(run.id))?.status, "failed");
});

test("a stale worker cannot append after a takeover completes the run", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "takeover" });
  await repository.saveRunTrigger(run.id, { mode: "answer", instruction: "continue" });
  let releaseStale!: () => void;
  let markStaleStarted!: () => void;
  const staleStarted = new Promise<void>((resolve) => { markStaleStarted = resolve; });
  const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
  let staleRejected = false;
  const stale = executeClaimedRun({
    runId: run.id,
    owner: "worker-a",
    repository,
    leaseMs: 1,
    renewEveryMs: 60_000,
    executor: {
      async run(input) {
        markStaleStarted();
        await staleGate;
        await assert.rejects(repository.appendEvent(run.id, {
          type: "warning",
          payload: { stale: true },
        }, input.lease), /lease is stale|already terminal/i);
        staleRejected = true;
        return { exitReason: "completed" };
      },
    },
  });
  await staleStarted;
  await new Promise((resolve) => setTimeout(resolve, 5));

  const takeover = await executeClaimedRun({
    runId: run.id,
    owner: "worker-b",
    repository,
    leaseMs: 60_000,
    renewEveryMs: 10_000,
    executor: {
      async run(input) {
        await repository.terminateRun(run.id, { exitReason: "completed" }, input.lease);
        return { exitReason: "completed" };
      },
    },
  });
  releaseStale();
  await stale;

  assert.equal(takeover.status, "completed");
  assert.equal(staleRejected, true);
  const terminal = (await repository.listEvents(run.id, 0, { visibility: "public" }))
    .filter((event) => event.type === "run_completed" || event.type === "run_failed");
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].type, "run_completed");
});

test("finalizes a run when the message commit succeeded before executor acknowledgement failed", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "committed-crash" });
  await repository.saveRunTrigger(run.id, { mode: "answer", instruction: "continue" });

  const result = await executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    executor: {
      async run(input) {
        await repository.appendEvent(run.id, {
          type: "message_committed",
          visibility: "public",
          attemptId: "attempt-1",
          logicalMessageId: "message-1",
          payload: { committed: true },
          dedupeKey: "message:committed",
        }, input.lease);
        throw new Error("lost acknowledgement after commit");
      },
    },
  });

  assert.equal(result.status, "completed");
  assert.equal((await repository.getRun(run.id))?.status, "completed");
  const terminal = (await repository.listEvents(run.id, 0, { visibility: "public" }))
    .filter((event) => event.type === "run_completed" || event.type === "run_failed");
  assert.deepEqual(terminal.map((event) => event.type), ["run_completed"]);
});
