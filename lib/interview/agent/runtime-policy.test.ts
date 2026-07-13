import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PLANNING_STEPS,
  MAX_TERMINAL_ATTEMPTS,
  isTerminalTool,
  toolsForRuntimePhase,
} from "./runtime-policy";

test("uses fifteen planning calls and three terminal attempts", () => {
  assert.equal(MAX_PLANNING_STEPS, 15);
  assert.equal(MAX_TERMINAL_ATTEMPTS, 3);
});

test("terminal phase exposes only submit interview turn", () => {
  const tools = new Map([
    ["get_resume_evidence", 1],
    ["submit_interview_turn", 2],
    ["finish_interview", 3],
  ]);
  assert.deepEqual([...toolsForRuntimePhase(tools, "terminal").keys()], [
    "submit_interview_turn",
  ]);
  assert.equal(isTerminalTool("submit_interview_turn"), true);
  assert.equal(isTerminalTool("ask_interview_question"), false);
  assert.equal(isTerminalTool("finish_interview"), false);
  assert.equal(isTerminalTool("get_resume_evidence"), false);
});
