import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { compactionSummaryMessage, selectCompactionRegion } from "./compaction";

test("compaction selection retains a recent tail and never splits a tool pair", () => {
  const messages = [
    { role: "user", content: "old" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "one", toolName: "read_file", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "one", toolName: "read_file", output: { type: "text", value: "result" } }] },
    ...Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `tail-${index}` })),
  ] as ModelMessage[];
  const region = selectCompactionRegion({ messages, surfaceSequences: messages.map((_, index) => index + 1), ignoredSequences: [] }, 100, 8);
  assert.ok(region);
  assert.deepEqual(region.shadowedSequences, [1, 2, 3]);
});

test("summary checkpoint is explicitly untrusted conversation data", () => {
  const message = compactionSummaryMessage("Known fact");
  assert.equal(message.role, "user");
  assert.match(String(message.content), /model-generated summary.*untrusted/);
});

test("moves a pressured cut forward to include a crossing tool result", () => {
  const messages = [
    { role: "user", content: "old" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "one", toolName: "read_file", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "one", toolName: "read_file", output: { type: "text", value: "result" } }] },
    ...Array.from({ length: 5 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `tail-${index}` })),
  ] as ModelMessage[];
  const region = selectCompactionRegion({ messages, surfaceSequences: messages.map((_, index) => index + 1), ignoredSequences: [] }, 100, 6);
  assert.deepEqual(region?.shadowedSequences, [1, 2, 3]);
});
