import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewDatabase } from "./persistence/repository";
import { startInterviewRunLease } from "./application/run-lease";

test("lease heartbeat aborts an executor when its fenced renewal is rejected", async () => {
  let renewals = 0;
  const lease = startInterviewRunLease({
    database: {} as InterviewDatabase,
    interviewRunId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    attemptGeneration: 2,
    leaseOwner: "00000000-0000-4000-8000-000000000003",
    signal: new AbortController().signal,
    renewIntervalMs: 5,
    renew: async () => {
      renewals += 1;
      return false;
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(lease.signal.aborted, true);
    assert.equal(renewals, 1);
  } finally {
    lease.stop();
  }
});

test("lease heartbeat stops cleanly without aborting its parent signal", async () => {
  let renewals = 0;
  const parent = new AbortController();
  const lease = startInterviewRunLease({
    database: {} as InterviewDatabase,
    interviewRunId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000003",
    signal: parent.signal,
    renewIntervalMs: 5,
    renew: async () => {
      renewals += 1;
      return true;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 12));
  lease.stop();
  const stoppedAt = renewals;
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(renewals, stoppedAt);
  assert.equal(parent.signal.aborted, false);
  assert.equal(lease.signal.aborted, false);
});
