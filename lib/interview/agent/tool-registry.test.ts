import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "./repository";
import {
  createAgentProviderStepSchema,
  createInterviewToolRegistry,
  interviewToolNames,
} from "./tool-registry";

test("provider schema constrains active tools and their arguments", () => {
  const schema = createAgentProviderStepSchema([
    "get_coverage_state",
    "ask_interview_question",
  ]);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-1",
    toolName: "get_coverage_state",
    args: {},
  }).success, true);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-2",
    toolName: "ask_interview_question",
    args: { question: "请自我介绍？" },
  }).success, false);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-3",
    toolName: "get_interview_history",
    args: { limit: 10 },
  }).success, false);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-4",
    toolName: "ask_interview_question",
    args: {
      action: "clarify",
      category: "introduction",
      intent: "new_topic",
      acknowledgement: "",
      question: "你希望面试前端还是全栈岗位？",
      claims: [],
      topic: "岗位澄清",
      resumeEvidenceIds: [],
      targetRole: {
        value: "前端工程师",
        status: "inferred",
        confidence: "low",
        sourceIds: ["resume:raw"],
      },
    },
  }).success, false);
});

test("rejects another question when deterministic policy requires completion", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const registry = createInterviewToolRegistry({
    handlers: Object.fromEntries([
      "get_resume_evidence", "get_interview_history", "get_coverage_state",
      "update_coverage", "ask_interview_question",
      "finish_interview",
    ].map((name) => [name, async () => ({})])) as never,
    async loadActionInput(input) {
      return {
        candidateRoundCount: 20,
        categoryCounts: {},
        recentQuestions: [],
        requestedUserEnd: false,
        proposal: {
          action: input.action,
          category: input.category,
          intent: input.intent,
          question: input.question,
          resumeEvidenceIds: input.resumeEvidenceIds,
        },
      };
    },
  });
  const definition = registry.get("ask_interview_question")!;
  const parsed = definition.inputSchema.parse({
    action: "ask",
    category: "technical_depth",
    intent: "follow_up",
    question: "继续追问？",
    topic: "缓存",
    resumeEvidenceIds: ["resume:structured"],
  });
  const error = await definition.validateBusiness(parsed, {
    interviewId: "interview",
    runId: run.id,
    repository,
  });
  assert.equal(error?.code, "INTERVIEW_MUST_FINISH");
});

test("does not expose formal scoring in the Agent tool registry", () => {
  const registry = createInterviewToolRegistry({
    handlers: {} as never,
    async loadActionInput() { throw new Error("not used"); },
  });
  assert.equal(registry.has("record_answer_evaluation" as never), false);
});

test("authorizes finish reasons from persisted state instead of model claims", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "finish-policy" });
  let requestedUserEnd = false;
  let candidateRoundCount = 0;
  const registry = createInterviewToolRegistry({
    handlers: Object.fromEntries(interviewToolNames.map((name) => [name, async () => ({})])) as never,
    async loadActionInput(input) {
      return {
        candidateRoundCount,
        categoryCounts: {},
        recentQuestions: [],
        requestedUserEnd,
        proposal: input,
      };
    },
  });
  const definition = registry.get("finish_interview")!;
  const context = { interviewId: "interview", runId: run.id, repository };
  const opening = await definition.validateBusiness({
    reason: "coverage_sufficient",
    closingMessage: "结束",
  }, context);
  assert.equal(opening?.code, "OPENING_CANNOT_FINISH");

  requestedUserEnd = true;
  candidateRoundCount = 3;
  const forged = await definition.validateBusiness({
    reason: "max_rounds",
    closingMessage: "结束",
  }, context);
  assert.equal(forged?.code, "INVALID_FINISH_REASON");
  const valid = await definition.validateBusiness({
    reason: "user_requested",
    closingMessage: "结束",
  }, context);
  assert.equal(valid, null);
});

test("validates claim source identity without comparing prose", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "sources" });
  const missingBySource = new Set(["answer:missing"]);
  const registry = createInterviewToolRegistry({
    handlers: Object.fromEntries(interviewToolNames.map((name) => [name, async () => ({})])) as never,
    async validateClaimSourceIds(sourceIds) {
      return sourceIds.filter((sourceId) => missingBySource.has(sourceId));
    },
    async loadActionInput(input) {
      return {
        candidateRoundCount: 1,
        categoryCounts: {},
        recentQuestions: [],
        requestedUserEnd: false,
        proposal: {
          action: input.action,
          category: input.category,
          intent: input.intent,
          question: input.question,
          resumeEvidenceIds: input.resumeEvidenceIds,
        },
      };
    },
  });
  const definition = registry.get("ask_interview_question")!;
  const baseInput = {
    action: "ask" as const,
    category: "technical_depth" as const,
    intent: "follow_up" as const,
    acknowledgement: "你说明了缓存键的分层思路。",
    question: "回滚失败时你如何保证最终一致性？",
    topic: "缓存一致性",
    resumeEvidenceIds: ["project:cache"],
  };
  const context = { interviewId: "interview", runId: run.id, repository };
  const missing = await definition.validateBusiness({
    ...baseInput,
    claims: [{ text: "缓存键采用分层设计", sourceIds: ["answer:missing"] }],
  }, context);
  assert.equal(missing?.code, "SOURCE_NOT_FOUND");
  const paraphrase = await definition.validateBusiness({
    ...baseInput,
    claims: [{ text: "完全不同的同义改写", sourceIds: ["answer:valid"] }],
  }, context);
  assert.equal(paraphrase, null);

  const missingRoleSource = await definition.validateBusiness({
    ...baseInput,
    claims: [],
    targetRole: {
      value: "后端工程师",
      status: "confirmed",
      confidence: "high",
      sourceIds: ["answer:missing"],
    },
  }, context);
  assert.equal(missingRoleSource?.code, "SOURCE_NOT_FOUND");
});
