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
  assert.equal(getCompletionRecoveryDisposition(failed, new Date()), "schedule");
});
