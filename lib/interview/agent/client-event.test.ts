import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentRunStreamEvent } from "./client-event";

test("parses only public persisted events with a positive cursor", () => {
  const event = parseAgentRunStreamEvent("reasoning_delta", {
    lastEventId: "7",
    data: JSON.stringify({ runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "分析" }),
  });
  assert.deepEqual(event, {
    type: "reasoning_delta",
    sequence: 7,
    payload: { runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "分析" },
  });
  assert.equal(parseAgentRunStreamEvent("checkpoint", { lastEventId: "8", data: "{}" }), null);
});

test("rejects malformed, internal, heartbeat, and non-positive events", () => {
  assert.equal(parseAgentRunStreamEvent("reasoning_delta", { lastEventId: "1", data: "{" }), null);
  assert.equal(parseAgentRunStreamEvent("reasoning_delta", { lastEventId: "0", data: "{}" }), null);
  assert.equal(parseAgentRunStreamEvent("reasoning_delta", { lastEventId: "1.5", data: "{}" }), null);
  assert.equal(parseAgentRunStreamEvent("heartbeat", { lastEventId: "9", data: JSON.stringify({ serverTime: new Date().toISOString() }) }), null);
  assert.equal(parseAgentRunStreamEvent("warning", { lastEventId: "10", data: "{}" }), null);
});

test("validates each public event payload strictly", () => {
  assert.equal(parseAgentRunStreamEvent("response_delta", {
    lastEventId: "11",
    data: JSON.stringify({ runId: "r1", attemptId: "a1", logicalMessageId: "m1", text: "问题", provisional: false }),
  }), null);
  assert.equal(parseAgentRunStreamEvent("tool_call_started", {
    lastEventId: "12",
    data: JSON.stringify({ runId: "r1", attemptId: "a1", toolCallId: "c1", toolName: "private_tool", publicLabel: "读取私密参数" }),
  }), null);
});

test("returns a discriminated payload union", () => {
  const event = parseAgentRunStreamEvent("response_started", {
    lastEventId: "13",
    data: JSON.stringify({ runId: "r1", attemptId: "a1", logicalMessageId: "m1" }),
  });
  assert.ok(event);
  if (event.type === "response_started") {
    const logicalMessageId: string = event.payload.logicalMessageId;
    assert.equal(logicalMessageId, "m1");
  }
});
