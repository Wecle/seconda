import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryCompletionJobRepository } from "./repository";
import { executeClaimedCompletionJob, getCompletionRecoveryDisposition } from "./worker";

test("executes one completion job once while leased", async () => {
  const repository = createInMemoryCompletionJobRepository();
  const job = await repository.createJob("interview");
  let calls = 0;
  const executor = { async run() { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); } };
  await Promise.all([
    executeClaimedCompletionJob({ jobId: job.id, owner: "a", repository, executor }),
    executeClaimedCompletionJob({ jobId: job.id, owner: "b", repository, executor }),
  ]);
  assert.equal(calls, 1);
  assert.equal((await repository.getJob(job.id))?.status, "completed");
});

test("failed and stale completion jobs can be recovered", async () => {
  const repository = createInMemoryCompletionJobRepository();
  const job = await repository.createJob("interview");
  await executeClaimedCompletionJob({ jobId: job.id, owner: "a", repository, executor: { async run() { throw new Error("boom"); } } });
  const failed = await repository.getJob(job.id);
  assert.ok(failed);
  assert.equal(getCompletionRecoveryDisposition(failed, new Date()), "cooldown");
  assert.equal(getCompletionRecoveryDisposition(failed, failed.nextAttemptAt!), "schedule");
});

test("completion jobs exhaust a three-attempt total budget", async () => {
  const repository = createInMemoryCompletionJobRepository();
  const job = await repository.createJob("interview");
  let now = new Date(0);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claimed = await repository.claimJob(job.id, `worker-${attempt}`, now, 1_000);
    assert.ok(claimed);
    const lease = { owner: `worker-${attempt}`, generation: claimed.leaseGeneration };
    await repository.failJob(job.id, lease, new Error("boom"), now);
    const current = await repository.getJob(job.id);
    assert.equal(current?.attemptCount, attempt);
    if (current?.nextAttemptAt) now = current.nextAttemptAt;
  }
  const exhausted = await repository.getJob(job.id);
  assert.equal(exhausted?.status, "exhausted");
  assert.equal(getCompletionRecoveryDisposition(exhausted!, now), "exhausted");
  assert.equal(await repository.claimJob(job.id, "late", now, 1_000), null);
});

test("stale completion lease generations cannot commit and takeover spends the total attempt budget", async () => {
  const repository = createInMemoryCompletionJobRepository();
  const job = await repository.createJob("interview");
  const startedAt = new Date();
  const first = await repository.claimJob(job.id, "worker-a", startedAt, 1_000);
  const second = await repository.claimJob(job.id, "worker-b", new Date(startedAt.getTime() + 2_000), 1_000);
  assert.ok(first && second);
  assert.equal(second.attemptCount, 2);
  assert.equal(await repository.completeJob(job.id, { owner: "worker-a", generation: first.leaseGeneration }), false);
  assert.equal(await repository.completeJob(job.id, { owner: "worker-b", generation: second.leaseGeneration }), true);
});

test("repeated stale completion takeovers stop at the total execution budget", async () => {
  const repository = createInMemoryCompletionJobRepository();
  const job = await repository.createJob("crashing-interview");
  let now = new Date(0);
  for (let execution = 1; execution <= 3; execution += 1) {
    const claimed = await repository.claimJob(job.id, `worker-${execution}`, now, 1_000);
    assert.ok(claimed);
    assert.equal(claimed.attemptCount, execution);
    now = new Date(now.getTime() + 2_000);
  }
  assert.equal(await repository.claimJob(job.id, "worker-4", now, 1_000), null);
  assert.equal((await repository.getJob(job.id))?.status, "exhausted");
});

test("lease renewal loss aborts the active completion executor", async () => {
  const base = createInMemoryCompletionJobRepository();
  const job = await base.createJob("interview");
  let observedAbort = false;
  const repository = {
    ...base,
    async renewLease() { return false; },
  };
  const result = await executeClaimedCompletionJob({
    jobId: job.id,
    owner: "worker-a",
    repository,
    renewEveryMs: 1,
    executor: {
      async run({ signal }) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            observedAbort = true;
            resolve();
          }, { once: true });
        });
      },
    },
  });
  assert.equal(observedAbort, true);
  assert.equal(result.status, "lease_lost");
});
