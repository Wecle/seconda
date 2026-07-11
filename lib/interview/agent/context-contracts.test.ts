import assert from "node:assert/strict";
import test from "node:test";
import { contextSnapshotSchema } from "./contracts";

test("validates durable context checkpoints", () => {
  const snapshot = contextSnapshotSchema.parse({
    cacheEpoch: 2,
    throughMessageSequence: 12,
    tokenEstimate: 4200,
    compactionLevel: 2,
    summary: "候选人负责缓存策略设计。",
    resumeEvidenceIds: ["project:seconda:abc123"],
    activeThreads: [{ category: "technical_depth", topic: "Prompt Cache" }],
    categoryCounts: { technical_depth: 2 },
    recentTailStartSequence: 9,
  });
  assert.equal(snapshot.cacheEpoch, 2);
});

test("rejects invalid compaction levels and negative boundaries", () => {
  assert.equal(contextSnapshotSchema.safeParse({
    cacheEpoch: -1,
    throughMessageSequence: -1,
    tokenEstimate: 0,
    compactionLevel: 4,
    summary: "",
    resumeEvidenceIds: [],
    activeThreads: [],
    categoryCounts: {},
    recentTailStartSequence: 0,
  }).success, false);
});
