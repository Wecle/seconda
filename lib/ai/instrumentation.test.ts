import assert from "node:assert/strict";
import test from "node:test";
import { register } from "../../instrumentation";

const validEnv = {
  FAST_MODEL_API_KEY: "fast-key",
  QUALITY_MODEL_API_KEY: "quality-key",
  AI_MODEL_FAST: "deepseek/fast",
  AI_MODEL_QUALITY: "zhipu/quality",
  AI_APPROVED_MODELS: "deepseek/fast,zhipu/quality",
};

test("accepts valid Node.js direct-provider configuration", () => {
  assert.doesNotThrow(() => register(validEnv));
});

test("requires both layer keys in Node.js", () => {
  for (const name of ["FAST_MODEL_API_KEY", "QUALITY_MODEL_API_KEY"] as const) {
    const withoutKey: Partial<typeof validEnv> = { ...validEnv };
    delete withoutKey[name];
    assert.throws(() => register(withoutKey), new RegExp(name));
  }
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
