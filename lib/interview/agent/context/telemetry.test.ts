import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModelUsage } from "./telemetry";

test("normalizes provider usage and cache details", () => {
  assert.deepEqual(normalizeModelUsage({
    inputTokens: 120,
    outputTokens: 30,
    inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 10 },
  }), { inputTokens: 120, outputTokens: 30, cachedInputTokens: 80, cacheWriteTokens: 10 });
});

test("keeps unavailable cache metrics distinguishable from zero", () => {
  assert.deepEqual(normalizeModelUsage({ inputTokens: 10, outputTokens: 2 }), {
    inputTokens: 10,
    outputTokens: 2,
    cachedInputTokens: null,
    cacheWriteTokens: null,
  });
});

test("sanitizes invalid usage values", () => {
  assert.deepEqual(normalizeModelUsage({ inputTokens: -1, outputTokens: Number.NaN }), {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: null,
    cacheWriteTokens: null,
  });
});
