import assert from "node:assert/strict";
import test from "node:test";
import { agentRoomReducer, initialAgentRoomState } from "./room-state";

test("candidate appears before a newly expanded thinking panel", () => {
  let state = initialAgentRoomState();
  state = agentRoomReducer(state, { type: "candidate_submitted", localId: "m", content: "回答" });
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r" });
  assert.equal(state.messages[0].content, "回答");
  assert.equal(state.thinking.expanded, true);
});

test("auto collapses on commit, stays expanded on failure, and resets manual choice for a new run", () => {
  let state = agentRoomReducer(initialAgentRoomState(), { type: "run_accepted", runId: "r1" });
  assert.equal(agentRoomReducer(state, { type: "message_committed" }).thinking.expanded, false);
  assert.equal(agentRoomReducer(state, { type: "run_failed" }).thinking.expanded, true);
  state = agentRoomReducer(state, { type: "thinking_toggled", expanded: false });
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r2" });
  assert.deepEqual({ mode: state.thinking.mode, expanded: state.thinking.expanded }, { mode: "auto", expanded: true });
});
