import assert from "node:assert/strict";
import type { AgentEventType } from "../lib/interview/agent/contracts";
import { initialAgentRoomState, type PublicRoomEvent } from "../lib/interview/agent/room-state";

const runId = "ui-contract-run";
const logicalMessageId = "ui-contract-message";
const committedMessage = {
  id: logicalMessageId,
  runId,
  sequence: 2,
  role: "assistant" as const,
  kind: "question" as const,
  content: "请说明自动降级条件？",
};

function publicEvent(sequence: number, type: AgentEventType, payload: unknown): PublicRoomEvent {
  return { runId, sequence, type, payload };
}

const events = [
  publicEvent(1, "reasoning_started", { runId, attemptId: "a1", entryId: "reasoning:a1" }),
  publicEvent(2, "reasoning_delta", { runId, attemptId: "a1", entryId: "reasoning:a1", text: "先核对证据。" }),
  publicEvent(3, "proposal_authorized", { runId, attemptId: "a1", logicalMessageId, proposalHash: "a".repeat(64) }),
  publicEvent(4, "response_started", { runId, attemptId: "a1", logicalMessageId }),
  publicEvent(5, "response_delta", { runId, attemptId: "a1", logicalMessageId, text: "请说明自动降级条件？", provisional: true }),
  publicEvent(6, "message_committed", { runId, attemptId: "a1", logicalMessageId, message: committedMessage }),
];

const reasoningState = initialAgentRoomState([], [], events.slice(0, 1));
assert.equal(reasoningState.turns[runId].thinking.expanded, true);

const responseStartedState = initialAgentRoomState([], [], events.slice(0, 4));
assert.equal(responseStartedState.turns[runId].thinking.expanded, false);

const streamingState = initialAgentRoomState([], [], events.slice(0, 5));
assert.equal(streamingState.turns[runId].provisionalResponse, "请说明自动降级条件？");

const committedState = initialAgentRoomState([], [], events);
assert.equal(committedState.turns[runId].provisionalResponse, "");
assert.equal(committedState.messages.filter((message) => message.id === logicalMessageId).length, 1);
assert.equal(committedState.messages.find((message) => message.id === logicalMessageId)?.content, committedMessage.content);

const replayedState = initialAgentRoomState([], [], [...events, ...events.slice(3)]);
assert.deepEqual(replayedState, committedState);

process.stdout.write("Validated live reasoning room protocol.\n");
