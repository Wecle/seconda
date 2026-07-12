import assert from "node:assert/strict";
import test from "node:test";
import { getRecoveryDisposition } from "./worker";
import type { AgentRunRecord } from "./repository";

const base: AgentRunRecord = {
  id: "run",
  interviewId: "interview",
  status: "running",
  exitReason: null,
  leaseOwner: null,
  leaseExpiresAt: null,
  resumeCount: 0,
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
