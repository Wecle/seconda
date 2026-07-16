import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  interviewTurnProposalSchema,
  RESPONSE_TEXT_SCHEMA_DESCRIPTION,
} from "./turn-proposal";
import {
  createAgentProviderStepSchema,
  createInterviewToolRegistry,
  interviewToolInputSchemas,
  interviewToolNames,
  providerInterviewToolInputSchemas,
} from "./tool-registry";

const terminalInput = {
  assessment: null,
  coverageChanges: [],
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
  assert.equal(providerInterviewToolInputSchemas.get_coverage_state.safeParse({}).success, false);
  assert.equal(providerInterviewToolInputSchemas.get_coverage_state.safeParse({
    publicAnalysis: "先检查当前能力覆盖情况。",
  }).success, true);
  assert.equal(interviewToolInputSchemas.get_coverage_state.safeParse({}).success, true);
  assert.equal(interviewToolInputSchemas.get_coverage_state.safeParse({
    publicAnalysis: "不能进入业务输入",
  }).success, false);
});

test("keeps public analysis first and response text last in terminal JSON Schema", () => {
  const schema = z.toJSONSchema(
    providerInterviewToolInputSchemas.submit_interview_turn,
  ) as { properties?: Record<string, unknown> };
  assert.deepEqual(Object.keys(schema.properties ?? {}), [
    "publicAnalysis",
    "assessment",
    "coverageChanges",
    "decision",
    "responseText",
  ]);
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
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /ask\/clarify.*一个核心考察意图/);
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /回答提示.*多个疑问句/);
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
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /finish.*不得邀请候选人继续作答/);
  assert.match(
    RESPONSE_TEXT_SCHEMA_DESCRIPTION,
    /岗位方向置信度足够.*decision.action 为 ask.*简短问候.*岗位或方向.*自我介绍邀请/,
  );
  assert.match(
    RESPONSE_TEXT_SCHEMA_DESCRIPTION,
    /岗位方向置信度不足.*decision.action 为 clarify.*围绕岗位方向澄清这一核心意图.*暂缓.*自我介绍/,
  );
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /不得枚举或复述简历/);
});

test("provider schema accepts only active real tool calls", () => {
  const schema = createAgentProviderStepSchema([
    "get_coverage_state",
    "submit_interview_turn",
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
