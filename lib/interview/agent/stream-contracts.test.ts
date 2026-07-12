import assert from "node:assert/strict";
import test from "node:test";
import {
  agentStreamEventSchema,
  messageCommittedPayloadSchema,
  responseStartedPayloadSchema,
  textDeltaPayloadSchema,
} from "./contracts";

test("requires attempt-scoped provisional text deltas", () => {
  assert.equal(textDeltaPayloadSchema.safeParse({
    runId: "run-1",
    messageId: "message-1",
    attemptId: "attempt-1",
    text: "请介绍",
    provisional: true,
  }).success, true);
  assert.equal(textDeltaPayloadSchema.safeParse({
    messageId: "message-1",
    text: "missing attempt",
    provisional: true,
  }).success, false);
});

test("requires committed messages to reference their durable sequence", () => {
  assert.equal(messageCommittedPayloadSchema.safeParse({
    runId: "run-1",
    messageId: "message-1",
    messageSequence: 3,
  }).success, true);
  assert.equal(messageCommittedPayloadSchema.safeParse({ messageId: "message-1" }).success, false);
});

test("requires response identity and run correlation for public response events", () => {
  assert.deepEqual(responseStartedPayloadSchema.parse({ runId: "run-1", messageId: "message-1" }), {
    runId: "run-1", messageId: "message-1",
  });
  assert.equal(textDeltaPayloadSchema.safeParse({ messageId: "message-1", attemptId: "a", text: "Q", provisional: true }).success, false);
  assert.equal(messageCommittedPayloadSchema.safeParse({ messageId: "message-1", messageSequence: 3 }).success, false);
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
