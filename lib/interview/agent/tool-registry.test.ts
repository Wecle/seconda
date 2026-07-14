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

test("exposes the candidate response contract in the provider JSON Schema", () => {
  const schema = z.toJSONSchema(
    interviewToolInputSchemas.submit_interview_turn,
  ) as { properties?: { responseText?: { description?: string } } };

  assert.equal(
    schema.properties?.responseText?.description,
    RESPONSE_TEXT_SCHEMA_DESCRIPTION,
  );
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /ask\/clarify.*只能包含一个疑问句.*一个.*[?？]/);
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /finish.*不得.*[?？]/);
  assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /开场.*简短问候.*岗位或方向.*自我介绍邀请/);
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
    args: {},
  }).success, true);
  assert.equal(schema.safeParse({
    type: "tool_call",
    callId: "call-2",
    toolName: "submit_interview_turn",
    args: terminalInput,
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
