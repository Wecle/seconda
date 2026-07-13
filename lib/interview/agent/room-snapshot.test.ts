import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { serializePublicRoomEvents } from "./room-snapshot";

test("serializes the complete public room event envelope", () => {
  const createdAt = new Date("2026-07-14T00:00:00.000Z");
  assert.deepEqual(serializePublicRoomEvents([{
    id: "event-1",
    runId: "run-1",
    sequence: 4,
    type: "response_started",
    visibility: "public",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    payload: {
      runId: "run-1",
      attemptId: "attempt-1",
      logicalMessageId: "message-1",
    },
    createdAt,
  }]), [{
    id: "event-1",
    runId: "run-1",
    sequence: 4,
    type: "response_started",
    visibility: "public",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    payload: {
      runId: "run-1",
      attemptId: "attempt-1",
      logicalMessageId: "message-1",
    },
    createdAt: createdAt.toISOString(),
  }]);
});

test("rejects internal events from the room snapshot DTO", () => {
  assert.throws(() => serializePublicRoomEvents([{
    id: "event-1",
    runId: "run-1",
    sequence: 1,
    type: "checkpoint",
    visibility: "internal",
    attemptId: null,
    logicalMessageId: null,
    payload: {},
    createdAt: new Date(),
  }]));
});

test("interview snapshot endpoint selects and serializes the durable envelope", async () => {
  const source = await readFile(
    new URL("../../../app/api/interviews/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /id:\s*interviewAgentEvents\.id/);
  assert.match(source, /createdAt:\s*interviewAgentEvents\.createdAt/);
  assert.match(source, /eq\(interviewAgentEvents\.visibility,\s*"public"\)/);
  assert.match(source, /publicEvents:\s*serializePublicRoomEvents\(publicEvents\)/);
});
