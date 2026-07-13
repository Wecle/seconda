import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentRunEventsPath, latestRunSnapshotSequence, nextReconnectDelay } from "./client-stream";

test("uses full jitter and stops after five reconnects", () => {
  assert.equal(nextReconnectDelay(0, () => 0.5), 250);
  assert.equal(nextReconnectDelay(1, () => 0.5), 500);
  assert.equal(nextReconnectDelay(4, () => 0.5), 4_000);
  assert.equal(nextReconnectDelay(5, () => 0.5), null);
});

test("the EventSource hook registers only current public event names", () => {
  const source = readFileSync(new URL("../../../components/interview/use-agent-run-stream.ts", import.meta.url), "utf8");
  assert.match(source, /publicAgentEventTypes/);
  assert.doesNotMatch(source, /"thinking_started"|"thinking_summary"|"text_delta"|"checkpoint"|"warning"/);
  assert.match(source, /callbacksRef/);
  assert.match(source, /cursorRef\.current = Math\.max[\s\S]+callbacksRef\.current\.onEvent/);
});

test("starts the hydrated latest run after its persisted snapshot cursor", () => {
  const events = [
    { runId: "older", sequence: 11 },
    { runId: "latest", sequence: 3 },
    { runId: "latest", sequence: 8 },
  ];
  const cursor = latestRunSnapshotSequence(events, "latest");
  assert.equal(cursor, 8);
  assert.equal(agentRunEventsPath("interview", "latest", cursor), "/api/interviews/interview/runs/latest/events?after=8");
  assert.equal(latestRunSnapshotSequence(events, "new-run"), 0);
});

test("the room passes its hydrated event cursor into the stable stream hook", () => {
  const source = readFileSync(new URL("../../../components/interview/agent-interview-room.tsx", import.meta.url), "utf8");
  assert.match(source, /latestRunSnapshotSequence\(initialEvents, runId\)/);
  assert.match(source, /afterSequence: hydratedRunSequence/);
});
