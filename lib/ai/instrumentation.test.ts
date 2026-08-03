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

test("accepts absent pricing and observe-first budget defaults", () => {
  assert.doesNotThrow(() => register(validEnv));
});

test("accepts valid pricing and explicit resource budgets", () => {
  assert.doesNotThrow(() => register({
    ...validEnv,
    AI_BUDGET_MODE: "enforce",
    AI_AGENT_RUN_TOKEN_LIMIT: "600000",
    AI_COMPLETION_TOKEN_LIMIT: "1700000",
    AI_MODEL_PRICING_JSON: JSON.stringify({
      version: 1,
      models: {
        "deepseek/fast": {
          inputMicrosPerMillion: 1,
          outputMicrosPerMillion: 2,
        },
      },
    }),
  }));
});

test("rejects invalid resource budget modes and limits", () => {
  assert.throws(
    () => register({ ...validEnv, AI_BUDGET_MODE: "blocking" }),
    /AI resource policy is invalid/,
  );
  assert.throws(
    () => register({ ...validEnv, AI_AGENT_RUN_TOKEN_LIMIT: "0" }),
    /AI resource policy is invalid/,
  );
});

test("rejects malformed pricing configuration", () => {
  assert.throws(
    () => register({ ...validEnv, AI_MODEL_PRICING_JSON: "{invalid" }),
    /AI_MODEL_PRICING_JSON is invalid/,
  );
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
