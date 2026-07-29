import assert from "node:assert/strict";
import test from "node:test";
import { deliverAgentRunEvent } from "@/lib/interview/agent/client/event-delivery";

const event = {
  type: "run_completed",
  sequence: 7,
  payload: { runId: "run-1" },
};

test("converts an async callback rejection into a failed delivery", async () => {
  const result = await deliverAgentRunEvent(
    async () => {
      throw new Error("refresh failed");
    },
    event,
  );

  assert.equal(result, "failed");
});

test("reports a successful synchronous callback", async () => {
  assert.equal(await deliverAgentRunEvent(() => {}, event), "delivered");
});
