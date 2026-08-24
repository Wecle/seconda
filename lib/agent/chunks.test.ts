import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantChunk, compactAssistantBlocks } from "./chunks";

test("assembles independent reasoning and text blocks in stream order", () => {
  let blocks = applyAssistantChunk([], { type: "block-start", index: 0, blockType: "reasoning" });
  blocks = applyAssistantChunk(blocks, { type: "reasoning-delta", index: 0, text: "inspect " });
  blocks = applyAssistantChunk(blocks, { type: "reasoning-delta", index: 0, text: "files" });
  blocks = applyAssistantChunk(blocks, { type: "block-end", index: 0, blockType: "reasoning" });
  blocks = applyAssistantChunk(blocks, { type: "block-start", index: 1, blockType: "text" });
  blocks = applyAssistantChunk(blocks, { type: "text-delta", index: 1, text: "Done" });

  assert.deepEqual(compactAssistantBlocks(blocks), [
    { kind: "reasoning", text: "inspect files", active: false },
    { kind: "text", text: "Done", active: true },
  ]);
});

test("ignores malformed chunks without mutating the current projection", () => {
  const blocks = [{ kind: "text" as const, text: "safe", active: false }];
  assert.equal(applyAssistantChunk(blocks, { type: "reasoning-delta", index: -1, text: "bad" }), blocks);
  assert.equal(applyAssistantChunk(blocks, { type: "reasoning-delta", index: 0, text: 42 }), blocks);
});
