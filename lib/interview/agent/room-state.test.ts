import assert from "node:assert/strict";
import test from "node:test";
import { agentRoomReducer, initialAgentRoomState } from "./room-state";

test("candidate appears before a newly expanded thinking panel", () => {
  let state = initialAgentRoomState();
  state = agentRoomReducer(state, { type: "candidate_submitted", localId: "m", content: "回答" });
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r" });
  assert.equal(state.messages[0].content, "回答");
  assert.equal(state.turns.r.thinking.expanded, true);
});

test("auto collapses when response starts, stays expanded on failure, and isolates runs", () => {
  let state = agentRoomReducer(initialAgentRoomState(), { type: "run_accepted", runId: "r1" });
  state = agentRoomReducer(state, { type: "response_started", runId: "r1", messageId: "a1" });
  assert.equal(state.turns.r1.thinking.expanded, false);
  state = agentRoomReducer(state, { type: "run_failed", runId: "r1" });
  assert.equal(state.turns.r1.thinking.expanded, true);
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r2" });
  assert.equal(state.turns.r2.thinking.expanded, true);
});

test("ignores text before response_started and binds artifacts to their run", () => {
  let state = agentRoomReducer(initialAgentRoomState(), { type: "run_accepted", runId: "r1" });
  state = agentRoomReducer(state, { type: "provisional_delta", runId: "r1", messageId: "m", text: "hidden" });
  assert.equal(state.turns.r1.provisional, "");
  state = agentRoomReducer(state, { type: "artifact_committed", artifact: { runId: "r1", artifactId: "a", type: "background_saved", title: "背景已保存", summary: "ok", details: [] } });
  assert.equal(state.turns.r1.artifacts.length, 1);
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
