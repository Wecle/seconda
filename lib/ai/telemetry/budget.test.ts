import assert from "node:assert/strict";
import test from "node:test";
import { decideBudget, loadAIResourcePolicy } from "./budget";

test("loads observe-first resource policy defaults", () => {
  assert.deepEqual(loadAIResourcePolicy({}), {
    mode: "observe",
    agentRunTokenLimit: 500_000,
    completionTokenLimit: 1_500_000,
  });
});

test("loads explicit valid resource policy", () => {
  assert.deepEqual(loadAIResourcePolicy({
    AI_BUDGET_MODE: "enforce",
    AI_AGENT_RUN_TOKEN_LIMIT: "600000",
    AI_COMPLETION_TOKEN_LIMIT: "1700000",
  }), {
    mode: "enforce",
    agentRunTokenLimit: 600_000,
    completionTokenLimit: 1_700_000,
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
    { AI_AGENT_RUN_TOKEN_LIMIT: "0" },
    { AI_AGENT_RUN_TOKEN_LIMIT: "-1" },
    { AI_AGENT_RUN_TOKEN_LIMIT: "1.5" },
    { AI_AGENT_RUN_TOKEN_LIMIT: "0x10" },
    { AI_COMPLETION_TOKEN_LIMIT: "1e6" },
    { AI_COMPLETION_TOKEN_LIMIT: "9007199254740992" },
  ]) {
    assert.throws(
      () => loadAIResourcePolicy(env),
      (error) => error instanceof Error && /AI resource policy is invalid/.test(error.message),
    );
  }
});
