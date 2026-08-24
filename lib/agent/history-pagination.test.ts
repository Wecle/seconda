import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrentHistoryRequest } from "./history-pagination";

test("a late older-history page cannot update a newly selected session", () => {
  assert.equal(isCurrentHistoryRequest({
    requestVersion: 4, currentVersion: 5,
    requestSessionId: "old", currentSessionId: "new",
  }), false);
  assert.equal(isCurrentHistoryRequest({
    requestVersion: 5, currentVersion: 5,
    requestSessionId: "new", currentSessionId: "new",
  }), true);
});
