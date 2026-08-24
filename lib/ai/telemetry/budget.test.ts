import assert from "node:assert/strict";
import test from "node:test";
import { decideBudget, loadAIResourcePolicy } from "./budget";

test("loads observe-first resource policy defaults", () => {
  assert.deepEqual(loadAIResourcePolicy({}), {
    mode: "observe",
    taskTokenLimit: 500_000,
  });
});

test("loads explicit valid resource policy", () => {
  assert.deepEqual(loadAIResourcePolicy({
    AI_BUDGET_MODE: "enforce",
    AI_TASK_TOKEN_LIMIT: "600000",
  }), {
    mode: "enforce",
    taskTokenLimit: 600_000,
  });
});

test("observe allows while marking an exhausted budget", () => {
  assert.deepEqual(decideBudget({
    mode: "observe",
    usedTokens: 500_000,
    tokenLimit: 500_000,
  }), { action: "allow", wouldExceed: true });
});

test("enforce rejects an exhausted budget before another request", () => {
  assert.deepEqual(decideBudget({
    mode: "enforce",
    usedTokens: 500_000,
    tokenLimit: 500_000,
  }), { action: "reject", wouldExceed: true });
});

test("off never compares usage and under-limit scopes are allowed", () => {
  assert.deepEqual(decideBudget({
    mode: "off",
    usedTokens: 500_000,
    tokenLimit: 1,
  }), { action: "allow", wouldExceed: false });
  assert.deepEqual(decideBudget({
    mode: "enforce",
    usedTokens: 499_999,
    tokenLimit: 500_000,
  }), { action: "allow", wouldExceed: false });
});

test("rejects invalid modes and token limits with sanitized errors", () => {
  for (const env of [
    { AI_BUDGET_MODE: "blocking" },
    { AI_TASK_TOKEN_LIMIT: "0" },
    { AI_TASK_TOKEN_LIMIT: "-1" },
    { AI_TASK_TOKEN_LIMIT: "1.5" },
    { AI_TASK_TOKEN_LIMIT: "0x10" },
    { AI_TASK_TOKEN_LIMIT: "1e6" },
    { AI_TASK_TOKEN_LIMIT: "9007199254740992" },
  ]) {
    assert.throws(
      () => loadAIResourcePolicy(env),
      (error) => error instanceof Error && /AI resource policy is invalid/.test(error.message),
    );
  }
});
