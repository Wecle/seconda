import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import {
  contextPressure,
  cropToolResultMessage,
  estimateTextTokens,
  resolveContextBudget,
  resolveContextCapacity,
  resolveContextWindow,
} from "./context-budget";

test("context windows prefer explicit registration metadata", () => {
  assert.equal(resolveContextWindow("vendor/model", { AGENT_MODEL_CONTEXT_WINDOWS_JSON: '{"vendor/model":131072}' }), 131_072);
  assert.equal(resolveContextWindow("vendor/model", {}), 64_000);
  assert.equal(resolveContextWindow("deepseek/deepseek-v4-flash", {}), 1_048_576);
  assert.equal(resolveContextWindow("deepseek/deepseek-v4-pro", {}), 1_048_576);
});

test("operational budget parses configuration and defaults with clamping", () => {
  // Default for V4 Flash is 128K
  assert.equal(resolveContextBudget("deepseek/deepseek-v4-flash"), 128_000);
  assert.equal(resolveContextBudget("deepseek/deepseek-v4-pro"), 128_000);

  // Custom budget from environment
  const env = { AGENT_MODEL_CONTEXT_BUDGETS_JSON: '{"deepseek/deepseek-v4-flash":64000}' };
  assert.equal(resolveContextBudget("deepseek/deepseek-v4-flash", 1_048_576, env), 64_000);

  // Clamped if budget is configured larger than hard window
  const excessiveEnv = { AGENT_MODEL_CONTEXT_BUDGETS_JSON: '{"test/model":200000}' };
  assert.equal(resolveContextBudget("test/model", 100_000, excessiveEnv), 100_000);

  // Invalid JSON or non-integer falls back gracefully
  assert.equal(resolveContextBudget("deepseek/deepseek-v4-flash", 1_048_576, { AGENT_MODEL_CONTEXT_BUDGETS_JSON: "invalid" }), 128_000);
  assert.equal(resolveContextBudget("deepseek/deepseek-v4-flash", 1_048_576, { AGENT_MODEL_CONTEXT_BUDGETS_JSON: '{"deepseek/deepseek-v4-flash":-10}' }), 128_000);
});

test("resolveContextCapacity combines hard window and operational budget", () => {
  const capacity = resolveContextCapacity("deepseek/deepseek-v4-flash", {});
  assert.equal(capacity.hardContextWindow, 1_048_576);
  assert.equal(capacity.operationalBudget, 128_000);
  assert.equal(capacity.maxOutputTokens, 8_192);
});

test("token estimate accounts for CJK more densely than ASCII", () => {
  assert.ok(estimateTextTokens("上下文生命周期") > estimateTextTokens("context"));
  assert.equal(contextPressure({ estimatedTokens: 50_000, contextWindow: 64_000 }).pressured, true);
});

test("context pressure separates operational budget threshold from hard safety limit", () => {
  // Request of ~58,884 tokens on 1M hard window and 128K budget: NOT pressured!
  const normalTurn = contextPressure({
    estimatedTokens: 58_884,
    hardContextWindow: 1_048_576,
    operationalBudget: 128_000,
  });
  assert.equal(normalTurn.pressured, false);
  assert.equal(normalTurn.pressureThreshold, 99_840);
  assert.equal(normalTurn.reserveTokens, 8_192);

  // Request of 100,000 tokens on 128K budget: pressured because it exceeds 99,840 threshold
  const pressuredTurn = contextPressure({
    estimatedTokens: 100_000,
    hardContextWindow: 1_048_576,
    operationalBudget: 128_000,
  });
  assert.equal(pressuredTurn.pressured, true);

  // Request approaching hard window safety limit
  const nearHardLimit = contextPressure({
    estimatedTokens: 996_000,
    hardContextWindow: 1_048_576,
    operationalBudget: 1_000_000,
  });
  assert.equal(nearHardLimit.pressured, true);
});

test("large tool results retain pairing identity and bounded preview", () => {
  const message = {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "call-1", toolName: "read_file", output: { type: "text", value: "x".repeat(20_000) } }],
  } as ModelMessage;
  const cropped = cropToolResultMessage(message);
  assert.ok(cropped && Array.isArray(cropped.content));
  const part = cropped.content[0] as unknown as Record<string, unknown>;
  assert.equal(part.toolCallId, "call-1");
  assert.match(JSON.stringify(cropped), /spilled to the durable event log/);
  assert.ok(JSON.stringify(cropped).length < 8_000);
});
