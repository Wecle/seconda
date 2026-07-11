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
