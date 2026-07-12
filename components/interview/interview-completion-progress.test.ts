import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletionView } from "./interview-completion-progress";

test("enables report only after completion", () => {
  assert.equal(buildCompletionView("scoring", null).reportEnabled, false);
  assert.equal(buildCompletionView("reporting", null).reportEnabled, false);
  assert.equal(buildCompletionView("completed", null).reportEnabled, true);
});
