import assert from "node:assert/strict";
import test from "node:test";
import { calculateAttemptCost, parseModelPricing } from "./pricing";

const pricedModel = {
  inputMicrosPerMillion: 1_000_000,
  outputMicrosPerMillion: 2_000_000,
  cacheReadMicrosPerMillion: 100_000,
  cacheWriteMicrosPerMillion: 1_250_000,
};

test("parses versioned model prices and calculates one rounded attempt cost", () => {
  const pricing = parseModelPricing(JSON.stringify({
    version: 1,
    models: { "deepseek/fast": pricedModel },
  }));

  assert.deepEqual(pricing.models["deepseek/fast"], pricedModel);
  assert.equal(calculateAttemptCost({
    inputTokens: 1_000_000,
    outputTokens: 10,
    cachedInputTokens: 200_000,
    cacheWriteTokens: 100_000,
  }, pricing.models["deepseek/fast"]), 845_020);
});

test("returns an empty version-one registry when pricing is absent", () => {
  assert.deepEqual(parseModelPricing(undefined), { version: 1, models: {} });
});

test("returns unknown cost when prices or cache billing units are absent", () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 10,
    cacheWriteTokens: null,
  };

  assert.equal(calculateAttemptCost(usage, undefined), null);
  assert.equal(calculateAttemptCost(usage, {
    inputMicrosPerMillion: 1,
    outputMicrosPerMillion: 1,
  }), null);
});

test("returns unknown cost for inconsistent or unsafe Usage", () => {
  assert.equal(calculateAttemptCost({
    inputTokens: 100,
    outputTokens: 1,
    cachedInputTokens: 80,
    cacheWriteTokens: 30,
  }, pricedModel), null);
  assert.equal(calculateAttemptCost({
    inputTokens: Number.MAX_SAFE_INTEGER + 1,
    outputTokens: 1,
    cachedInputTokens: null,
    cacheWriteTokens: null,
  }, pricedModel), null);
});

test("rejects unsupported versions, unsafe prices, and unknown keys", () => {
  assert.throws(
    () => parseModelPricing('{"version":2,"models":{}}'),
    /AI_MODEL_PRICING_JSON is invalid/,
  );
  assert.throws(
    () => parseModelPricing(JSON.stringify({
      version: 1,
      models: { "deepseek/fast": { ...pricedModel, inputMicrosPerMillion: Number.MAX_SAFE_INTEGER + 1 } },
    })),
    /AI_MODEL_PRICING_JSON is invalid/,
  );
  assert.throws(
    () => parseModelPricing('{"version":1,"models":{},"secret":"must-not-leak"}'),
    (error) => error instanceof Error &&
      /AI_MODEL_PRICING_JSON is invalid/.test(error.message) &&
      !error.message.includes("must-not-leak"),
  );
});

test("rejects malformed JSON without reflecting its content", () => {
  assert.throws(
    () => parseModelPricing('{private-provider-token'),
    (error) => error instanceof Error &&
      error.message === "AI_MODEL_PRICING_JSON is invalid" &&
      !error.message.includes("private-provider-token"),
  );
});
