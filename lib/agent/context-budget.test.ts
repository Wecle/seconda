import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { contextPressure, cropToolResultMessage, estimateTextTokens, resolveContextWindow } from "./context-budget";

test("context windows prefer explicit registration metadata", () => {
  assert.equal(resolveContextWindow("vendor/model", { AGENT_MODEL_CONTEXT_WINDOWS_JSON: '{"vendor/model":131072}' }), 131_072);
  assert.equal(resolveContextWindow("vendor/model", {}), 64_000);
});
test("token estimate accounts for CJK more densely than ASCII", () => {
  assert.ok(estimateTextTokens("上下文生命周期") > estimateTextTokens("context"));
  assert.equal(contextPressure({ estimatedTokens: 50_000, contextWindow: 64_000 }).pressured, true);
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
