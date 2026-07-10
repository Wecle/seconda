import assert from "node:assert/strict";
import test from "node:test";
import { register } from "../../instrumentation";

const validEnv = {
  AI_GATEWAY_API_KEY: "test-key",
  AI_MODEL_FAST: "google/fast",
  AI_MODEL_QUALITY: "anthropic/quality",
  AI_APPROVED_MODELS: "google/fast,anthropic/quality",
};

test("accepts a valid Node.js Gateway configuration", () => {
  assert.doesNotThrow(() => register(validEnv));
});

test("requires a Gateway key in Node.js", () => {
  const { AI_GATEWAY_API_KEY: _key, ...withoutKey } = validEnv;
  assert.throws(() => register(withoutKey), /AI_GATEWAY_API_KEY/);
});

test("rejects invalid Node.js model configuration", () => {
  assert.throws(
    () => register({ ...validEnv, AI_MODEL_FAST: "invalid" }),
    /creator\/model/,
  );
});

test("skips validation in the Edge runtime", () => {
  assert.doesNotThrow(() => register({ NEXT_RUNTIME: "edge" }));
});
