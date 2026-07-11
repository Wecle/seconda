import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptPipe, canonicalJson, type PromptSegment } from "./prompt-pipe";

const stable: PromptSegment[] = [
  { id: "rules", version: "1", priority: 100, cacheScope: "global", trimPolicy: "never", content: "固定规则" },
  { id: "resume", version: "1", priority: 90, cacheScope: "interview", trimPolicy: "never", content: "简历概览" },
];

test("keeps a byte-identical stable prefix when volatile tail changes", () => {
  const first = buildPromptPipe({
    stableSegments: stable,
    tailSegments: [{ id: "current", version: "1", priority: 10, cacheScope: "turn", trimPolicy: "drop", content: canonicalJson({ runId: "run-1", answer: "A" }) }],
    contextWindow: 10_000,
    outputReserve: 1_000,
  });
  const second = buildPromptPipe({
    stableSegments: stable,
    tailSegments: [{ id: "current", version: "1", priority: 10, cacheScope: "turn", trimPolicy: "drop", content: canonicalJson({ runId: "run-2", answer: "B" }) }],
    contextWindow: 10_000,
    outputReserve: 1_000,
  });
  assert.equal(first.stablePrefix, second.stablePrefix);
  assert.notEqual(first.incrementalTail, second.incrementalTail);
});

test("canonicalizes object keys and tool ordering", () => {
  assert.equal(canonicalJson({ z: 1, a: [{ y: 2, b: 1 }] }), '{"a":[{"b":1,"y":2}],"z":1}');
});

test("drops low-priority tail segments before exceeding budget", () => {
  const result = buildPromptPipe({
    stableSegments: [{ id: "rules", version: "1", priority: 100, cacheScope: "global", trimPolicy: "never", content: "x".repeat(120) }],
    tailSegments: [
      { id: "important", version: "1", priority: 50, cacheScope: "turn", trimPolicy: "drop", content: "y".repeat(150) },
      { id: "optional", version: "1", priority: 1, cacheScope: "turn", trimPolicy: "drop", content: "z".repeat(150) },
    ],
    contextWindow: 250,
    outputReserve: 20,
  });
  assert.equal(result.includedTailIds.includes("important"), true);
  assert.equal(result.includedTailIds.includes("optional"), false);
  assert.ok(result.estimatedTokens <= result.effectiveBudget);
});
