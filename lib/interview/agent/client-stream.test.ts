import assert from "node:assert/strict";
import test from "node:test";
import { nextReconnectDelay } from "./client-stream";

test("uses full jitter and stops after five reconnects", () => {
  assert.equal(nextReconnectDelay(0, () => 0.5), 250);
  assert.equal(nextReconnectDelay(1, () => 0.5), 500);
  assert.equal(nextReconnectDelay(4, () => 0.5), 4_000);
  assert.equal(nextReconnectDelay(5, () => 0.5), null);
});
