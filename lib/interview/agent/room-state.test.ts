import assert from "node:assert/strict";
import test from "node:test";
import type { CommittedInterviewMessage, PublicAgentEventType } from "./contracts";
import {
  agentRoomReducer,
  initialAgentRoomState,
  type AgentRoomState,
  type PublicRoomEvent,
} from "./room-state";

function committedMessage(content: string, id = "m1"): CommittedInterviewMessage {
  return {
    id,
    runId: "r1",
    sequence: 2,
    role: "assistant",
    kind: "question",
    content,
  };
}

function reasoningState(): AgentRoomState {
  let state = initialAgentRoomState([], [], []);
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r1", logicalMessageId: "m1" });
  state = agentRoomReducer(state, { type: "attempt_started", runId: "r1", attemptId: "a1", logicalMessageId: "m1" });
  state = agentRoomReducer(state, { type: "reasoning_started", runId: "r1", attemptId: "a1" });
  return agentRoomReducer(state, {
    type: "reasoning_delta",
    runId: "r1",
    attemptId: "a1",
    entryId: "reasoning:a1",
    text: "核对证据。",
  });
}

function respondingState(input: { text: string }): AgentRoomState {
  let state = reasoningState();
  state = agentRoomReducer(state, {
    type: "response_started",
    runId: "r1",
    attemptId: "a1",
    logicalMessageId: "m1",
  });
  return agentRoomReducer(state, {
    type: "response_delta",
    runId: "r1",
    attemptId: "a1",
    logicalMessageId: "m1",
    text: input.text,
    provisional: true,
  });
}

function roomEvent(sequence: number, type: PublicAgentEventType, payload: unknown): PublicRoomEvent {
  return { runId: "r1", sequence, type, payload };
}

test("candidate appears before a newly expanded thinking panel", () => {
  let state = initialAgentRoomState();
  state = agentRoomReducer(state, { type: "candidate_submitted", localId: "m", content: "回答" });
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r1", logicalMessageId: "m1" });
  assert.equal(state.messages[0].content, "回答");
  assert.equal(state.turns.r1.thinking.expanded, true);
});

test("expands reasoning then collapses when response starts", () => {
  let state = initialAgentRoomState([], [], []);
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r1", logicalMessageId: "m1" });
  state = agentRoomReducer(state, { type: "reasoning_started", runId: "r1", attemptId: "a1" });
  assert.equal(state.turns.r1.thinking.expanded, true);
  state = agentRoomReducer(state, { type: "reasoning_delta", runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "核对证据。" });
  state = agentRoomReducer(state, { type: "response_started", runId: "r1", attemptId: "a1", logicalMessageId: "m1" });
  assert.equal(state.turns.r1.thinking.expanded, false);
  assert.equal(state.turns.r1.phase, "responding");
});

test("respects manual collapse while reasoning continues", () => {
  let state = reasoningState();
  state = agentRoomReducer(state, { type: "thinking_toggled", runId: "r1", expanded: false });
  state = agentRoomReducer(state, { type: "reasoning_delta", runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "继续分析。" });
  assert.equal(state.turns.r1.thinking.expanded, false);
  assert.equal(state.turns.r1.thinking.userToggled, true);
});

test("lets the user reopen reasoning after response start collapses it", () => {
  let state = respondingState({ text: "问题" });
  assert.equal(state.turns.r1.thinking.expanded, false);
  state = agentRoomReducer(state, { type: "thinking_toggled", runId: "r1", expanded: true });
  assert.equal(state.turns.r1.thinking.expanded, true);
});

test("updates a public read-tool progress entry without exposing data", () => {
  let state = reasoningState();
  state = agentRoomReducer(state, { type: "tool_call_started", runId: "r1", attemptId: "a1", toolCallId: "call-1", publicLabel: "正在核对简历证据" });
  state = agentRoomReducer(state, { type: "tool_call_completed", runId: "r1", attemptId: "a1", toolCallId: "call-1", publicLabel: "已核对简历证据" });
  const entry = state.turns.r1.reasoningEntries.find((candidate) => candidate.entryId === "tool:call-1");
  assert.deepEqual(entry, {
    entryId: "tool:call-1",
    attemptId: "a1",
    kind: "tool",
    text: "已核对简历证据",
    status: "completed",
    discarded: false,
  });
});

test("discards response but preserves reasoning across attempts", () => {
  let state = respondingState({ text: "旧问题" });
  state = agentRoomReducer(state, { type: "response_discarded", runId: "r1", attemptId: "a1", logicalMessageId: "m1", reason: "provider_stream_failed" });
  assert.equal(state.turns.r1.reasoningEntries.every((entry) => entry.attemptId !== "a1" || entry.discarded), true);
  state = agentRoomReducer(state, { type: "attempt_discarded", runId: "r1", attemptId: "a1", logicalMessageId: "m1", reason: "provider_stream_failed" });
  state = agentRoomReducer(state, { type: "attempt_started", runId: "r1", attemptId: "a2", logicalMessageId: "m1" });
  assert.equal(state.turns.r1.provisionalResponse, "");
  assert.equal(state.turns.r1.reasoningEntries.some((entry) => entry.attemptId === "a1"), true);
  assert.equal(state.turns.r1.reasoningEntries.every((entry) => entry.attemptId !== "a1" || entry.discarded), true);
  assert.equal(state.turns.r1.currentAttemptId, "a2");
});

test("reconciles the authoritative committed message without refresh", () => {
  let state = respondingState({ text: "临时问题" });
  state = agentRoomReducer(state, {
    type: "message_committed",
    runId: "r1",
    attemptId: "a1",
    logicalMessageId: "m1",
    message: committedMessage("最终问题？"),
  });
  assert.equal(state.turns.r1.provisionalResponse, "");
  assert.equal(state.messages.filter((message) => message.id === "m1").length, 1);
  assert.equal(state.messages.find((message) => message.id === "m1")?.content, "最终问题？");
});

test("deduplicates replayed sequences without duplicating deltas", () => {
  const events = [
    roomEvent(1, "reasoning_started", { runId: "r1", attemptId: "a1", entryId: "reasoning:a1" }),
    roomEvent(2, "reasoning_delta", { runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "先核对证据。" }),
    roomEvent(3, "response_started", { runId: "r1", attemptId: "a1", logicalMessageId: "m1" }),
    roomEvent(4, "response_delta", { runId: "r1", attemptId: "a1", logicalMessageId: "m1", text: "最终问题？", provisional: true }),
  ];
  let state = initialAgentRoomState([], [], events);
  const replayed = initialAgentRoomState([], [], [...events, ...events]);
  assert.deepEqual(replayed, state);
  state = agentRoomReducer(state, { type: "response_delta", sequence: 4, runId: "r1", attemptId: "a1", logicalMessageId: "m1", text: "最终问题？", provisional: true });
  assert.equal(state.turns.r1.provisionalResponse, "最终问题？");
});

test("rejects a public event whose envelope and payload identify different runs", () => {
  const state = initialAgentRoomState([], [], [
    roomEvent(1, "reasoning_started", { runId: "r2", attemptId: "a1", entryId: "reasoning:a1" }),
  ]);
  assert.deepEqual(state.turns, {});
});

test("hydrates an authoritative commit without duplicating committed text", () => {
  const message = committedMessage("最终问题？");
  const state = initialAgentRoomState(
    [message],
    [],
    [
      roomEvent(1, "reasoning_started", { runId: "r1", attemptId: "a1", entryId: "reasoning:a1" }),
      roomEvent(2, "reasoning_delta", { runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "分析" }),
      roomEvent(3, "response_started", { runId: "r1", attemptId: "a1", logicalMessageId: "m1" }),
      roomEvent(4, "response_delta", { runId: "r1", attemptId: "a1", logicalMessageId: "m1", text: "最终问题？", provisional: true }),
      roomEvent(5, "message_committed", { runId: "r1", attemptId: "a1", logicalMessageId: "m1", message }),
    ],
  );
  assert.equal(state.turns.r1.thinking.expanded, false);
  assert.equal(state.turns.r1.provisionalResponse, "");
  assert.equal(state.messages.filter((candidate) => candidate.id === "m1").length, 1);
});

test("treats an existing assistant message as a collapsed committed turn without new protocol events", () => {
  const message = committedMessage("历史问题？");
  const state = initialAgentRoomState(
    [message],
    [],
    [
      roomEvent(1, "response_started", { runId: "r1", attemptId: "a1", logicalMessageId: "m1" }),
      roomEvent(2, "response_delta", { runId: "r1", attemptId: "a1", logicalMessageId: "m1", text: "旧 provisional", provisional: true }),
    ],
  );
  assert.equal(state.turns.r1.phase, "committing");
  assert.equal(state.turns.r1.thinking.expanded, false);
  assert.equal(state.turns.r1.provisionalResponse, "");
  assert.equal(state.turns.r1.responseStarted, true);
});

test("restores one pending answer and reconciles a response-lost duplicate", () => {
  let state = initialAgentRoomState([{ id: "durable", sequence: 2, role: "user", kind: "answer", content: "回答", status: "sent" }]);
  state = agentRoomReducer(state, { type: "candidate_submitted", localId: "local", content: "回答" });
  state = agentRoomReducer(state, { type: "candidate_submitted", localId: "local", content: "回答" });
  assert.equal(state.messages.filter((message) => message.id === "local").length, 1);
  state = agentRoomReducer(state, { type: "candidate_failed", localId: "local" });
  state = agentRoomReducer(state, { type: "candidate_retrying", localId: "local" });
  assert.equal(state.messages.find((message) => message.id === "local")?.status, "sending");
  state = agentRoomReducer(state, {
    type: "candidate_committed",
    localId: "local",
    runId: "run",
    message: { id: "durable", sequence: 2, content: "回答" },
  });
  assert.equal(state.messages.filter((message) => message.id === "durable").length, 1);
  assert.equal(state.messages.some((message) => message.id === "local"), false);
});
