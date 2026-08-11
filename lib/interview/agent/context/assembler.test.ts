import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assembleAgentContext,
  assembleTurnRuntimeContext,
  collectAllowedTerms,
} from "./assembler";
import { indexResumeEvidence } from "@/lib/interview/agent/domain/resume-evidence";

const base = {
  language: "zh",
  persona: "standard",
  preference: "项目深挖",
  targetRole: "前端工程师",
  targetRoleStatus: "inferred",
  targetRoleConfidence: "high",
  targetRoleSourceIds: ["project:0:abc"],
  openingStage: "role_resolution" as const,
  resumeOverview: '{"title":"Frontend Engineer"}',
  evidenceDirectory: [{ id: "project:0:abc", kind: "project", label: "Seconda" }],
  cacheEpoch: 1,
  checkpointSummary: "此前已讨论项目背景",
  coverage: [{ category: "resume_project", questionCount: 2, status: "partial" }],
  recentMessages: [{ id: "message-4", sequence: 4, role: "assistant", kind: "question", content: "为什么这样设计？" }],
};

test("binds the authoritative latest answer to the active or replacement run", async () => {
  const source = await readFile(new URL("./assembler.ts", import.meta.url), "utf8");
  assert.match(source, /input\.answerMessageId/);
  assert.match(source, /eq\(interviewMessages\.id, input\.answerMessageId\)/);
  assert.match(source, /eq\(interviewMessages\.runId, input\.runId\)/);
});

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
  assert.equal(context.stablePrefix.includes('"targetRoleStatus":"inferred"'), true);
});

test("keeps only the latest eight raw messages", () => {
  const recentMessages = Array.from({ length: 12 }, (_, index) => ({
    id: `message-${index + 1}`,
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

test("exposes stable source ids for recent candidate answers", () => {
  const context = assembleAgentContext({
    ...base,
    recentMessages: [{
      id: "message-1",
      sequence: 5,
      role: "user",
      kind: "answer",
      content: "我负责缓存失效策略。",
      sourceId: "answer:message-1",
    }],
    currentInstruction: "继续",
    runId: "run",
  });
  assert.equal(context.incrementalTail.includes('"id":"message-1"'), true);
  assert.equal(context.incrementalTail.includes('"sourceId":"answer:message-1"'), true);
});

test("keeps prior committed assessments and the latest raw answer in the incremental tail", () => {
  const context = assembleAgentContext({
    ...base,
    currentInstruction: "继续",
    runId: "run",
    latestAnswer: {
      id: "answer-2",
      category: "technical_depth",
      content: "我使用租约和幂等键处理故障恢复。",
    },
    priorAssessments: [{
      id: "assessment-1",
      answerMessageId: "answer-1",
      publicSummary: "上一轮回答需要追问结果。",
      followUpNeeded: true,
    }],
  });
  assert.equal(context.stablePrefix.includes("assessment-1"), false);
  assert.equal(context.incrementalTail.includes("assessment-1"), true);
  assert.equal(context.incrementalTail.includes("我使用租约和幂等键处理故障恢复。"), true);
  assert.equal(context.incrementalTail.includes("当前回答已完成轻量评估"), false);
});

test("keeps the clarification answer in the turn tail without treating it as a formal answer", () => {
  const context = assembleAgentContext({
    ...base,
    openingStage: "awaiting_role_clarification",
    currentInstruction: "确认候选岗位",
    runId: "run-clarification",
    clarificationAnswer: {
      id: "clarification-1",
      content: "我希望面试前端工程师岗位。",
    },
  });
  assert.equal(context.stablePrefix.includes("awaiting_role_clarification"), true);
  assert.equal(context.incrementalTail.includes("latest-clarification-answer"), true);
  assert.equal(context.incrementalTail.includes("我希望面试前端工程师岗位。"), true);
  assert.equal(context.incrementalTail.includes("latest-raw-answer"), false);
});

test("builds a clarification runtime context with no formal answer category", () => {
  const turnContext = assembleTurnRuntimeContext({
    mode: "opening_clarification",
    openingStage: "awaiting_role_clarification",
    latestAnswer: null,
    clarificationAnswer: { id: "clarification-1", content: "前端工程师" },
    language: "zh",
    persona: "standard",
    allowedTerms: ["前端工程师"],
  });

  assert.equal(turnContext.mode, "opening_clarification");
  assert.equal(turnContext.openingStage, "awaiting_role_clarification");
  assert.equal(turnContext.answerCategory, null);
  assert.equal(turnContext.answerMessageId, "clarification-1");
  assert.equal(turnContext.clarificationAnswer, "前端工程师");
});

test("recursively authorizes only immutable resume candidate answers and deterministic config", () => {
  const evidence = indexResumeEvidence({
    title: "NestedResumeRole",
    projects: [{
      name: "NestedResumeProject",
      details: { database: "ResumePostgreSQL" },
    }],
  }, "ImmutableResumeRawText");
  const allowed = collectAllowedTerms({
    evidence,
    preference: "DeterministicPreference",
    targetRole: "DeterministicTargetRole",
    candidateMessages: [
      { role: "assistant", kind: "question", content: "AssistantHallucination" },
      { role: "user", kind: "answer", content: "CandidateRawAnswer" },
      { role: "user", kind: "clarification_answer", content: "CandidateRoleClarification" },
    ],
    currentAnswer: "CurrentCandidateAnswer",
  });

  for (const permitted of [
    "NestedResumeRole",
    "NestedResumeProject",
    "ResumePostgreSQL",
    "ImmutableResumeRawText",
    "DeterministicPreference",
    "DeterministicTargetRole",
    "CandidateRawAnswer",
    "CandidateRoleClarification",
    "CurrentCandidateAnswer",
  ]) {
    assert.equal(allowed.some((term) => term.includes(permitted)), true, permitted);
  }
  const modelDerived = {
    checkpoint: { summary: "CheckpointHallucination" },
    coverage: [{ topic: "CoverageHallucination" }],
    assessment: {
      publicSummary: "AssessmentSummaryHallucination",
      extractedEvidence: ["AssessmentEvidenceHallucination"],
      missingPoints: ["AssessmentMissingHallucination"],
    },
    assistantMessage: "AssistantHallucination",
    instruction: "InstructionHallucination",
  };
  for (const forbidden of recursiveStrings(modelDerived)) {
    assert.equal(allowed.some((term) => term.includes(forbidden)), false, forbidden);
  }
});

function recursiveStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(recursiveStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(recursiveStrings);
}
