import assert from "node:assert/strict";
import test from "node:test";
import {
  agentEventRecordSchema,
  agentEventTypeSchema,
  agentStreamEventSchema,
  messageCommittedPayloadSchema,
  publicAgentEventPayloadSchemas,
  publicAgentEventTypes,
  proposalAuthorizedPayloadSchema,
  reasoningDeltaPayloadSchema,
  responseDeltaPayloadSchema,
  responseDiscardedPayloadSchema,
  responseStartedPayloadSchema,
  toolCallCompletedPayloadSchema,
  toolCallStartedPayloadSchema,
} from "./contracts";

test("separates public reasoning and response channels", () => {
  assert.equal(reasoningDeltaPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    entryId: "reasoning:attempt-1",
    text: "先核对回答中的证据。",
  }).success, true);
  assert.equal(responseDeltaPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    text: "请介绍",
    provisional: true,
  }).success, true);
  assert.equal(responseStartedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
  }).success, true);
});

test("requires authorization and discard identity", () => {
  assert.equal(proposalAuthorizedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    proposalHash: "a".repeat(64),
  }).success, true);
  assert.equal(responseDiscardedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    reason: "provider_stream_failed",
  }).success, true);
});

test("tool progress exposes labels but not arguments or results", () => {
  assert.equal(toolCallStartedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    toolCallId: "call-1",
    toolName: "get_resume_evidence",
    publicLabel: "正在核对简历证据",
  }).success, true);
  assert.equal(toolCallCompletedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    toolCallId: "call-1",
    toolName: "get_resume_evidence",
    publicLabel: "已核对简历证据",
  }).success, true);
  assert.equal(toolCallCompletedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    toolCallId: "call-1",
    toolName: "get_resume_evidence",
    publicLabel: "已核对简历证据",
    result: { private: true },
  }).success, false);
});

test("defines one strict payload schema for every public event", () => {
  assert.deepEqual(
    Object.keys(publicAgentEventPayloadSchemas).sort(),
    [...publicAgentEventTypes].sort(),
  );
});

test("keeps run start nullable before the first attempt", () => {
  assert.equal(publicAgentEventPayloadSchemas.run_started.safeParse({
    runId: "run-1",
    logicalMessageId: null,
  }).success, true);
});

test("validates strict scoring, reporting, and terminal payloads", () => {
  const scoring = {
    runId: "run-1",
    total: 4,
    pending: 1,
    scoring: 1,
    scored: 2,
    failed: 0,
  };
  assert.equal(publicAgentEventPayloadSchemas.scoring_progress.safeParse(scoring).success, true);
  assert.equal(publicAgentEventPayloadSchemas.scoring_progress.safeParse({
    ...scoring,
    privateQuestionIds: ["question-1"],
  }).success, false);
  assert.equal(publicAgentEventPayloadSchemas.reporting_started.safeParse({ runId: "run-1" }).success, true);
  assert.equal(publicAgentEventPayloadSchemas.reporting_started.safeParse({
    runId: "run-1",
    reportJson: {},
  }).success, false);
  assert.equal(publicAgentEventPayloadSchemas.run_completed.safeParse({
    runId: "run-1",
    exitReason: "completed",
    retryable: false,
    userMessage: "面试已结束。",
  }).success, true);
});

test("keeps historical event names out of the public protocol", () => {
  for (const type of ["thinking_started", "thinking_summary", "text_delta"] as const) {
    assert.equal(agentEventTypeSchema.safeParse(type).success, true);
    assert.equal(publicAgentEventTypes.includes(type as never), false);
  }
});

test("durable events carry explicit visibility and attempt identity", () => {
  assert.equal(agentEventRecordSchema.safeParse({
    id: "event-1",
    runId: "run-1",
    sequence: 7,
    type: "reasoning_delta",
    visibility: "public",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    payload: { text: "分析中" },
    createdAt: "2026-07-13T00:00:00.000Z",
  }).success, true);
  assert.equal(agentEventRecordSchema.safeParse({
    id: "event-1",
    runId: "run-1",
    sequence: 7,
    type: "reasoning_delta",
    visibility: "public",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    createdAt: "2026-07-13T00:00:00.000Z",
  }).success, false);
});

test("committed events carry the authoritative assistant message", () => {
  assert.equal(messageCommittedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    message: {
      id: "message-1",
      runId: "run-1",
      sequence: 4,
      role: "assistant",
      kind: "question",
      content: "请说明自动降级的触发条件？",
    },
  }).success, true);
  assert.equal(messageCommittedPayloadSchema.safeParse({
    runId: "run-1",
    logicalMessageId: "message-1",
  }).success, false);
  assert.equal(messageCommittedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    message: {
      id: "message-1",
      runId: "run-1",
      sequence: 4,
      role: "assistant",
      kind: "feedback",
      content: "不会通过公开提交事件发送。",
    },
  }).success, false);
});

test("keeps heartbeat outside persisted transcript events", () => {
  assert.equal(agentStreamEventSchema.safeParse({
    type: "heartbeat",
    serverTime: "2026-07-11T00:00:00.000Z",
  }).success, true);
  assert.equal(agentStreamEventSchema.safeParse({
    type: "heartbeat",
    sequence: 10,
    serverTime: "2026-07-11T00:00:00.000Z",
  }).success, false);
});
