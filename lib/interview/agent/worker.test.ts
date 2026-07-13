import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "./repository";
import { executeClaimedRun } from "./worker";

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
  const originalRenew = repository.renewLease.bind(repository);
  repository.renewLease = async (...args) => {
    renewals += 1;
    return originalRenew(...args);
  };
  await executeClaimedRun({
    runId: run.id,
    owner: "worker",
    repository,
    leaseMs: 50,
    renewEveryMs: 5,
    executor: {
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 16));
        await repository.completeRun(run.id, "completed");
        return { exitReason: "completed" };
      },
    },
  });
  assert.ok(renewals >= 2);
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
