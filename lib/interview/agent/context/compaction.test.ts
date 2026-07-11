import assert from "node:assert/strict";
import test from "node:test";
import {
  compactWithRecovery,
  shouldCompactContext,
  truncateOldestCompleteGroups,
} from "./compaction";

test("triggers every five rounds or under token pressure", () => {
  assert.equal(shouldCompactContext({ candidateRoundCount: 5, lastCompactedRound: 0, tokenEstimate: 100, effectiveBudget: 1000 }), true);
  assert.equal(shouldCompactContext({ candidateRoundCount: 4, lastCompactedRound: 0, tokenEstimate: 900, effectiveBudget: 1000 }), true);
  assert.equal(shouldCompactContext({ candidateRoundCount: 3, lastCompactedRound: 0, tokenEstimate: 500, effectiveBudget: 1000 }), false);
});

test("uses level two structured summary after pruning", async () => {
  const result = await compactWithRecovery({
    messages: [{ groupId: "1", role: "user", kind: "answer", content: "回答" }],
    summarize: async () => ({ summary: "结构化摘要", resumeEvidenceIds: ["project:1"], activeThreads: [] }),
  });
  assert.equal(result.level, 2);
  assert.equal(result.summary.summary, "结构化摘要");
});

test("falls back to level three after prompt-too-long", async () => {
  let calls = 0;
  const messages = Array.from({ length: 6 }, (_, index) => ({
    groupId: String(index), role: index % 2 ? "assistant" : "user", kind: "message", content: `message-${index}`,
  }));
  const result = await compactWithRecovery({
    messages,
    summarize: async (input) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("too long"), { code: "PROMPT_TOO_LONG" });
      return { summary: input.map((item) => item.content).join(","), resumeEvidenceIds: [], activeThreads: [] };
    },
  });
  assert.equal(result.level, 3);
  assert.equal(result.messages.length < messages.length, true);
});

test("never splits tool call and result pairs during truncation", () => {
  const messages = [
    { groupId: "old", role: "assistant", kind: "tool_call", toolCallId: "call-1", content: "call" },
    { groupId: "old", role: "tool", kind: "tool_result", toolCallId: "call-1", content: "result" },
    { groupId: "new", role: "user", kind: "answer", content: "keep" },
  ];
  const truncated = truncateOldestCompleteGroups(messages, 1);
  assert.equal(truncated.some((item) => item.toolCallId === "call-1"), false);
  assert.equal(truncated.some((item) => item.content === "keep"), true);
});

test("terminates after bounded recovery failure", async () => {
  await assert.rejects(compactWithRecovery({
    messages: [{ groupId: "1", role: "user", kind: "answer", content: "answer" }],
    summarize: async () => { throw Object.assign(new Error("too long"), { code: "PROMPT_TOO_LONG" }); },
  }), (error: unknown) => (error as { code?: string }).code === "PROMPT_TOO_LONG");
});
