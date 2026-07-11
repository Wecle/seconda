import assert from "node:assert/strict";
import test from "node:test";
import { isInterviewAgentEnabled } from "./feature";

test("enables Agent interviews by default after migration", () => {
  assert.equal(isInterviewAgentEnabled({}), true);
  assert.equal(isInterviewAgentEnabled({ INTERVIEW_AGENT_V2_ENABLED: "true" }), true);
});

test("supports an explicit rollback switch", () => {
  assert.equal(isInterviewAgentEnabled({ INTERVIEW_AGENT_V2_ENABLED: "false" }), false);
});
