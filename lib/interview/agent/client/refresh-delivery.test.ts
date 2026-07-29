import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAgentRoomRefresh,
  beginAgentRoomRequest,
  isLatestAgentRoomRequest,
} from "@/lib/interview/agent/client/refresh-delivery";

test("a later end refresh wins over a deferred terminal refresh", async () => {
  let releaseTerminal!: (value: { status: string }) => void;
  const terminalResponse = new Promise<{ status: string }>((resolve) => {
    releaseTerminal = resolve;
  });
  const epoch = { current: 0 };
  const appliedStatuses: string[] = [];

  const terminalEpoch = beginAgentRoomRequest(epoch);
  const terminalRefresh = applyAgentRoomRefresh(
    () => terminalResponse,
    (value) => {
      appliedStatuses.push(value.status);
    },
    () => isLatestAgentRoomRequest(epoch, terminalEpoch),
  );

  beginAgentRoomRequest(epoch);
  const endRefreshEpoch = beginAgentRoomRequest(epoch);
  await applyAgentRoomRefresh(
    async () => ({ status: "completing" }),
    (value) => {
      appliedStatuses.push(value.status);
    },
    () => isLatestAgentRoomRequest(epoch, endRefreshEpoch),
  );
  releaseTerminal({ status: "active" });

  assert.equal(await terminalRefresh, null);
  assert.deepEqual(appliedStatuses, ["completing"]);
});

test("applies an ordinary refresh without a fence", async () => {
  const applied: string[] = [];

  const result = await applyAgentRoomRefresh(
    async () => ({ runId: "run-current" }),
    (value) => {
      applied.push(value.runId);
    },
  );

  assert.deepEqual(result, { runId: "run-current" });
  assert.deepEqual(applied, ["run-current"]);
});
