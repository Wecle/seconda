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
