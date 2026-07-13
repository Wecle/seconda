import assert from "node:assert/strict";
import test from "node:test";
import { getCompletionResumeBlockReason } from "./resume-policy";

test("blocks active, legacy and jobless completion resume requests", () => {
  assert.match(getCompletionResumeBlockReason({ configVersion: 2, interviewStatus: "active", hasJob: true }) ?? "", /state/);
  assert.match(getCompletionResumeBlockReason({ configVersion: 1, interviewStatus: "scoring", hasJob: true }) ?? "", /v2/);
  assert.match(getCompletionResumeBlockReason({ configVersion: 2, interviewStatus: "scoring", hasJob: false }) ?? "", /job/);
});

test("allows only persisted completion flows and completed no-ops", () => {
  for (const interviewStatus of ["completing", "scoring", "reporting", "failed", "completed"]) {
    assert.equal(getCompletionResumeBlockReason({ configVersion: 2, interviewStatus, hasJob: true }), null);
  }
});
