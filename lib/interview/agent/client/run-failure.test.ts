import assert from "node:assert/strict";
import test from "node:test";
import { runFailurePresentation } from "@/lib/interview/agent/client/run-failure";

const failedRun = {
  id: "run",
  status: "failed" as const,
  exitReason: "terminal_action_failed",
  userMessage: "本轮问题生成未能通过运行规则，请重试。",
  lastEventSequence: 15,
};

test("hydrates a persistent retryable failure presentation", () => {
  assert.deepEqual(runFailurePresentation({ ...failedRun, recoveryDisposition: "failed" }), {
    message: failedRun.userMessage,
    action: "retry",
  });
});

test("keeps original-run recovery separate from replacement retry", () => {
  assert.deepEqual(runFailurePresentation({ ...failedRun, recoveryDisposition: "schedule" }), {
    message: failedRun.userMessage,
    action: "resume",
  });
});

test("does not present running or message-less runs as persisted failures", () => {
  assert.equal(runFailurePresentation({ ...failedRun, status: "running" }), null);
  assert.equal(runFailurePresentation({ ...failedRun, userMessage: null }), null);
});
