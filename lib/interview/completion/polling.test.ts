import assert from "node:assert/strict";
import test from "node:test";
import { nextCompletionPoll } from "./polling";

test("backs off and stops at terminal, hidden, offline, or two minutes", () => {
  assert.equal(nextCompletionPoll({ attempt: 0, elapsedMs: 0, status: "scoring", visible: true, online: true }), 1_500);
  assert.equal(nextCompletionPoll({ attempt: 1, elapsedMs: 2_000, status: "scoring", visible: true, online: true }), 3_000);
  assert.equal(nextCompletionPoll({ attempt: 3, elapsedMs: 20_000, status: "reporting", visible: true, online: true }), 10_000);
  assert.equal(nextCompletionPoll({ attempt: 1, elapsedMs: 2_000, status: "completed", visible: true, online: true }), null);
  assert.equal(nextCompletionPoll({ attempt: 1, elapsedMs: 2_000, status: "scoring", visible: false, online: true }), "paused");
  assert.equal(nextCompletionPoll({ attempt: 8, elapsedMs: 120_000, status: "scoring", visible: true, online: true }), null);
});
