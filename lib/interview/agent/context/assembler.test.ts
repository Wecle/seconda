import assert from "node:assert/strict";
import test from "node:test";
import { assembleAgentContext } from "./assembler";

const base = {
  language: "zh",
  persona: "standard",
  preference: "项目深挖",
  targetRole: "前端工程师",
  resumeOverview: '{"title":"Frontend Engineer"}',
  evidenceDirectory: [{ id: "project:0:abc", kind: "project", label: "Seconda" }],
  cacheEpoch: 1,
  checkpointSummary: "此前已讨论项目背景",
  coverage: [{ category: "resume_project", questionCount: 2, status: "partial" }],
  recentMessages: [{ sequence: 4, role: "assistant", kind: "question", content: "为什么这样设计？" }],
};

test("reuses the stable prefix across adjacent turn instructions", () => {
  const first = assembleAgentContext({ ...base, currentInstruction: "回答 A", runId: "run-a" });
  const second = assembleAgentContext({ ...base, currentInstruction: "回答 B", runId: "run-b" });
  assert.equal(first.stablePrefix, second.stablePrefix);
  assert.notEqual(first.incrementalTail, second.incrementalTail);
  assert.equal(first.stablePrefix.includes("run-a"), false);
});

test("keeps preference, checkpoint and compact coverage", () => {
  const context = assembleAgentContext({ ...base, currentInstruction: "继续", runId: "run" });
  assert.equal(context.stablePrefix.includes("项目深挖"), true);
  assert.equal(context.stablePrefix.includes("此前已讨论项目背景"), true);
  assert.equal(context.stablePrefix.includes('"questionCount":2'), true);
});

test("keeps only the latest eight raw messages", () => {
  const recentMessages = Array.from({ length: 12 }, (_, index) => ({
    sequence: index + 1,
    role: index % 2 ? "assistant" : "user",
    kind: index % 2 ? "question" : "answer",
    content: `message-${index + 1}`,
  }));
  const context = assembleAgentContext({ ...base, recentMessages, currentInstruction: "继续", runId: "run" });
  assert.equal(context.incrementalTail.includes("message-4"), false);
  assert.equal(context.incrementalTail.includes("message-5"), true);
  assert.equal(context.incrementalTail.includes("message-12"), true);
});

test("keeps the latest assessment in the incremental tail", () => {
  const context = assembleAgentContext({
    ...base,
    currentInstruction: "继续",
    runId: "run",
    latestAssessment: {
      id: "assessment-1",
      publicSummary: "需要追问结果",
      followUpNeeded: true,
    },
  });
  assert.equal(context.stablePrefix.includes("assessment-1"), false);
  assert.equal(context.incrementalTail.includes("assessment-1"), true);
});
