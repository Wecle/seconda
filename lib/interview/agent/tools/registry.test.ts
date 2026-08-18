import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  interviewTurnProposalSchema,
  RESPONSE_TEXT_SCHEMA_DESCRIPTION,
} from "@/lib/interview/agent/domain/turn-proposal";
import {
  createAgentProviderStepSchema,
  createInterviewToolRegistry,
  interviewToolInputSchemas,
  interviewToolNames,
  providerInterviewToolInputSchema,
} from "@/lib/interview/agent/tools/registry";

const terminalInput = {
  assessment: null,
  coverageChanges: [],
  roleResolution: {
    status: "inferred" as const,
    value: "后端工程师",
    confidence: "high" as const,
    resumeEvidenceIds: ["resume:raw"],
  },
  decision: {
    action: "ask" as const,
    category: "introduction" as const,
    intent: "new_topic" as const,
    evidenceIds: ["resume:raw"],
    coverageTarget: "岗位与自我介绍",
    estimatedInformationGain: "high" as const,
  },
  responseText: "请介绍一下自己。",
};

const terminalProviderInput = {
  publicAnalysis: "候选人的方向清晰，下一步邀请其介绍最近经历与岗位期待。",
  ...terminalInput,
};

const formalProposal = {
  assessment: {
    completeness: "high" as const,
    specificity: "medium" as const,
    evidenceStrength: "strong" as const,
    reflectionDepth: "surface" as const,
    followUpNeeded: true,
    missingPoints: ["触发阈值"],
    extractedEvidence: ["30 秒后自动降级"],
    publicSummary: "回答包含明确机制，但触发条件仍需追问。",
  },
  coverageChanges: [{
    category: "technical_depth" as const,
    topic: "降级机制",
    status: "partial" as const,
    resumeEvidenceIds: ["evidence-1"],
  }],
  roleResolution: null,
  decision: {
    action: "ask" as const,
    category: "technical_depth" as const,
    intent: "follow_up" as const,
    evidenceIds: ["evidence-1"],
    coverageTarget: "验证自动降级的触发条件",
    estimatedInformationGain: "high" as const,
  },
  responseText: "请说明自动降级的触发条件。",
};

const confirmedRoleProposal = {
  ...terminalInput,
  roleResolution: {
    status: "confirmed" as const,
    value: "后端工程师",
    confidence: "high" as const,
    resumeEvidenceIds: ["resume:raw"],
  },
};

const openingClarificationProposal = {
  assessment: null,
  coverageChanges: [],
  roleResolution: {
    status: "needs_clarification" as const,
    confidence: "low" as const,
    resumeEvidenceIds: ["resume:raw"],
  },
  decision: {
    action: "clarify" as const,
    subject: "target_role" as const,
    evidenceIds: ["resume:raw"],
    estimatedInformationGain: "high" as const,
  },
  responseText: "请问你的目标岗位是什么？",
};

test("exposes exactly three read tools and one terminal tool", () => {
  assert.deepEqual(interviewToolNames, [
    "get_resume_evidence",
    "get_interview_history",
    "get_coverage_state",
    "submit_interview_turn",
  ]);
  for (const removed of [
    "record_answer_evaluation",
    "update_coverage",
    "ask_interview_question",
    "finish_interview",
  ]) {
    assert.equal(interviewToolNames.includes(removed as never), false);
  }
});

test("uses the complete interview turn proposal as terminal input", () => {
  assert.equal(interviewToolInputSchemas.submit_interview_turn, interviewTurnProposalSchema);
  assert.equal(interviewToolInputSchemas.submit_interview_turn.safeParse(terminalInput).success, true);
  assert.equal(interviewToolInputSchemas.submit_interview_turn.safeParse({
    ...terminalInput,
    responseText: " ",
  }).success, false);
  assert.equal(interviewToolInputSchemas.submit_interview_turn.safeParse({
    ...terminalInput,
    extra: true,
  }).success, false);
});

test("requires provider-only public analysis for every model-visible tool", () => {
  const providerSchema = providerInterviewToolInputSchema("get_coverage_state", "answer");
  assert.equal(providerSchema.safeParse({}).success, false);
  assert.equal(providerSchema.safeParse({
    publicAnalysis: "先检查当前能力覆盖情况。",
  }).success, true);
  assert.equal(interviewToolInputSchemas.get_coverage_state.safeParse({}).success, true);
  assert.equal(interviewToolInputSchemas.get_coverage_state.safeParse({
    publicAnalysis: "不能进入业务输入",
  }).success, false);
});

test("keeps public analysis first and response text last in terminal JSON Schema", () => {
  for (const mode of ["opening", "opening_clarification", "answer"] as const) {
    const schema = z.toJSONSchema(
      providerInterviewToolInputSchema("submit_interview_turn", mode),
    ) as {
      properties?: Record<string, unknown>;
      anyOf?: Array<{ properties?: Record<string, unknown> }>;
    };
    const branches = schema.anyOf ?? [schema];
    for (const branch of branches) {
      const keys = Object.keys(branch.properties ?? {});
      assert.equal(keys[0], "publicAnalysis");
      assert.equal(keys.at(-1), "responseText");
    }
  }
});

test("exposes only the legal terminal contract for each run mode", () => {
  const publicAnalysis = "回答提供了方向信息，下一步核实项目证据。";
  const formal = providerInterviewToolInputSchema("submit_interview_turn", "answer");
  assert.equal(formal.safeParse({ publicAnalysis, ...formalProposal }).success, true);
  assert.equal(formal.safeParse({
    publicAnalysis,
    ...formalProposal,
    roleResolution: terminalInput.roleResolution,
  }).success, false);

  const opening = providerInterviewToolInputSchema("submit_interview_turn", "opening");
  assert.equal(opening.safeParse(terminalProviderInput).success, true);
  assert.equal(opening.safeParse({ publicAnalysis, ...openingClarificationProposal }).success, true);
  assert.equal(opening.safeParse({ publicAnalysis, ...formalProposal }).success, false);

  const confirmation = providerInterviewToolInputSchema(
    "submit_interview_turn",
    "opening_clarification",
  );
  assert.equal(confirmation.safeParse({ publicAnalysis, ...confirmedRoleProposal }).success, true);
  assert.equal(confirmation.safeParse(terminalProviderInput).success, false);
});

test("exposes the candidate response contract in the provider JSON Schema", () => {
  const schema = z.toJSONSchema(
    interviewToolInputSchemas.submit_interview_turn,
  ) as {
    properties?: {
      assessment?: { description?: string };
      coverageChanges?: {
        description?: string;
        items?: {
          properties?: { status?: { description?: string } };
        };
      };
      responseText?: { description?: string };
    };
  };

  assert.match(
    schema.properties?.assessment?.description ?? "",
    /followUpNeeded=true.*partial/,
  );
  assert.match(
    schema.properties?.assessment?.description ?? "",
    /followUpNeeded=false.*sufficient/,
  );
  assert.match(
    schema.properties?.coverageChanges?.description ?? "",
    /当前回答分类/,
  );
  assert.match(
    schema.properties?.coverageChanges?.items?.properties?.status?.description ?? "",
    /第 3 题.*exhausted/,
  );

  assert.equal(
    schema.properties?.responseText?.description,
    RESPONSE_TEXT_SCHEMA_DESCRIPTION,
  );
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /ask\/clarify.*唯一核心意图/);
  assert.equal(
    RESPONSE_TEXT_SCHEMA_DESCRIPTION.includes(["只能包含一个", "疑问句"].join("")),
    false,
  );
  assert.equal(
    RESPONSE_TEXT_SCHEMA_DESCRIPTION.includes(
      [["只能", "出现", "一个"].join(""), ["?", " 或 ", "？"].join("")].join(""),
    ),
    false,
  );
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /finish.*不得邀请继续作答/);
  assert.match(
    RESPONSE_TEXT_SCHEMA_DESCRIPTION,
    /role_resolution.*inferred.*introduction ask/,
  );
  assert.match(
    RESPONSE_TEXT_SCHEMA_DESCRIPTION,
    /role_resolution.*needs_clarification.*target_role clarify/,
  );
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /awaiting_role_clarification.*confirmed/);
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /formal_interview.*roleResolution 必须为 null/);
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /不得枚举或复述简历/);
});

test("provider schema accepts only active real tool calls", () => {
  const coverageSchema = providerInterviewToolInputSchema("get_coverage_state", "opening");
  const submitSchema = providerInterviewToolInputSchema("submit_interview_turn", "opening");
  const schema = createAgentProviderStepSchema([
    { name: "get_coverage_state", description: "coverage", inputSchema: coverageSchema },
    { name: "submit_interview_turn", description: "submit", inputSchema: submitSchema },
  ]);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-1",
    toolName: "get_coverage_state",
    args: { publicAnalysis: "先检查当前能力覆盖情况。" },
  }).success, true);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-2",
    toolName: "submit_interview_turn",
    args: terminalProviderInput,
  }).success, true);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-3",
    toolName: "ask_interview_question",
    args: {},
  }).success, false);
  assert.equal(schema.safeParse({
    type: "final",
    content: "请介绍一下自己。",
  }).success, false);
  assert.throws(() => createAgentProviderStepSchema([{
    name: "finish_interview",
    description: "unknown",
    inputSchema: z.object({}),
  }]), /Unknown Agent tool descriptor/);
});

test("registry contains only model-visible tools", () => {
  const handler = async () => ({ ok: true });
  const handlers = {
    get_resume_evidence: handler,
    get_interview_history: handler,
    get_coverage_state: handler,
    submit_interview_turn: handler,
  };
  const registry = createInterviewToolRegistry({ handlers });
  assert.deepEqual([...registry.keys()], [...interviewToolNames]);
});
