import assert from "node:assert/strict";
import test from "node:test";
import { AgentLoopDetector, type ToolCallObservation } from "./loop-detector";

function call(
  toolName: string,
  options: Partial<ToolCallObservation> = {},
): ToolCallObservation {
  return {
    toolName,
    args: { value: toolName },
    result: { status: "same" },
    progressHash: "unchanged",
    ...options,
  };
}

test("responds warning, warning, break to generic repetition", () => {
  const detector = new AgentLoopDetector();
  const decisions = Array.from({ length: 7 }, (_, index) =>
    detector.record(call("A", { progressHash: `progress-${index}` })),
  );
  assert.deepEqual(decisions[2], { level: "warning", warningNumber: 1, message: "检测到重复工具调用，请调整策略。" });
  assert.deepEqual(decisions[4], { level: "warning", warningNumber: 2, message: "重复调用仍未产生进展，禁止继续当前策略。" });
  assert.equal(decisions[6].level, "break");
});

test("detects ping-pong patterns", () => {
  const detector = new AgentLoopDetector();
  const decisions = ["A", "B", "A", "B", "A", "B", "A", "B"].map((name, index) =>
    detector.record(call(name, { progressHash: `progress-${index}` })),
  );
  assert.equal(decisions[3].level, "warning");
  assert.equal(decisions[5].level, "warning");
  assert.equal(decisions[7].level, "break");
});

test("detects polling with no progress", () => {
  const detector = new AgentLoopDetector();
  const decisions = Array.from({ length: 5 }, () =>
    detector.record(call("poll", { args: { cursor: 1 }, result: { status: "pending" } })),
  );
  assert.equal(decisions[2].level, "warning");
  assert.equal(decisions[3].level, "warning");
  assert.equal(decisions[4].level, "break");
});

test("does not flag polling whose result and progress change", () => {
  const detector = new AgentLoopDetector();
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(detector.record(call("poll", {
      result: { offset: index },
      progressHash: `progress-${index}`,
    })), { level: "continue" });
  }
});

test("detects repeated unknown tools", () => {
  const detector = new AgentLoopDetector();
  const decisions = Array.from({ length: 5 }, () =>
    detector.record(call("missing", { unknownTool: true })),
  );
  assert.equal(decisions[2].level, "warning");
  assert.equal(decisions[3].level, "warning");
  assert.equal(decisions[4].level, "break");
});

test("detects different calls with no global progress", () => {
  const detector = new AgentLoopDetector();
  const decisions = ["A", "B", "C", "D", "E"].map((name) =>
    detector.record(call(name, { args: { unique: name } })),
  );
  assert.equal(decisions[2].level, "warning");
  assert.equal(decisions[3].level, "warning");
  assert.equal(decisions[4].level, "break");
});

test("real progress resets the no-progress counter", () => {
  const detector = new AgentLoopDetector();
  detector.record(call("A"));
  detector.record(call("B"));
  assert.deepEqual(detector.record(call("C", { progressHash: "changed" })), { level: "continue" });
  assert.deepEqual(detector.record(call("D", { progressHash: "changed-again" })), { level: "continue" });
});

test("stable hashing ignores declared volatile result fields", () => {
  const detector = new AgentLoopDetector();
  const decisions = Array.from({ length: 3 }, (_, index) => detector.record(call("status", {
    result: { status: "pending", durationMs: index, sessionId: `session-${index}` },
    volatileResultFields: ["durationMs", "sessionId"],
  })));
  assert.equal(decisions[2].level, "warning");
});
