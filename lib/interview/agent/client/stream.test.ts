import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  agentRunEventsPath,
  latestRunSnapshotSequence,
  nextReconnectDelay,
} from "@/lib/interview/agent/client/stream";

test("uses full jitter and stops after five reconnects", () => {
  assert.equal(nextReconnectDelay(0, () => 0.5), 250);
  assert.equal(nextReconnectDelay(1, () => 0.5), 500);
  assert.equal(nextReconnectDelay(4, () => 0.5), 4_000);
  assert.equal(nextReconnectDelay(5, () => 0.5), null);
});

test("the EventSource hook registers only current public event names", () => {
  const source = readFileSync(new URL("../../../../components/interview/use-agent-run-stream.ts", import.meta.url), "utf8");
  assert.match(source, /publicAgentEventTypes/);
  assert.doesNotMatch(source, /"thinking_started"|"thinking_summary"|"text_delta"|"checkpoint"|"warning"/);
  assert.match(source, /callbacksRef/);
  assert.match(
    source,
    /if \(disposed \|\| cursorRunRef\.current !== runId\) return;[\s\S]+deliverAgentRunEvent\(callbacksRef\.current\.onEvent, event\)/,
  );
  assert.match(
    source,
    /const status = await response\.json\(\) as AgentRunStreamStatus;[\s\S]+if \(disposed \|\| cursorRunRef\.current !== runId\) return;[\s\S]+deliverAgentRunEvent\(callbacksRef\.current\.onTerminal, status\)/,
  );
  assert.match(source, /cursorRef\.current = Math\.max[\s\S]+deliverAgentRunEvent\(callbacksRef\.current\.onEvent, event\)/);
  assert.match(source, /result === "delivered" \? "terminal" : "manual_retry"/);
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
  const source = readFileSync(new URL("../../../../components/interview/agent-interview-room.tsx", import.meta.url), "utf8");
  assert.match(source, /latestRunSnapshotSequence\(initialEvents, runId\)/);
  assert.match(source, /afterSequence: hydratedRunSequence/);
});

test("terminal events converge the local run before the authoritative refresh", () => {
  const source = readFileSync(new URL("../../../../components/interview/agent-interview-room.tsx", import.meta.url), "utf8");
  const failedCase = source.slice(
    source.indexOf('case "run_failed":'),
    source.indexOf('case "run_completed":'),
  );
  const completedCase = source.slice(
    source.indexOf('case "run_completed":'),
    source.indexOf("default:", source.indexOf('case "run_completed":')),
  );

  assert.match(failedCase, /setRun\([\s\S]+status: "failed"[\s\S]+exitReason: event\.payload\.exitReason[\s\S]+userMessage: event\.payload\.userMessage/);
  assert.notEqual(failedCase.indexOf("setRun("), -1);
  assert.notEqual(failedCase.indexOf("await refresh("), -1);
  assert.ok(failedCase.indexOf("setRun(") < failedCase.indexOf("await refresh("));
  assert.match(completedCase, /setRun\([\s\S]+status: "completed"[\s\S]+exitReason: event\.payload\.exitReason[\s\S]+userMessage: event\.payload\.userMessage/);
  assert.notEqual(completedCase.indexOf("setRun("), -1);
  assert.notEqual(completedCase.indexOf("await refresh("), -1);
  assert.ok(completedCase.indexOf("setRun(") < completedCase.indexOf("await refresh("));
});

test("manual retry may replay a terminal run from the advanced cursor", () => {
  const source = readFileSync(new URL("../../../../components/interview/use-agent-run-stream.ts", import.meta.url), "utf8");

  assert.match(source, /retryVersion > 0/);
  assert.match(source, /agentRunEventsPath\(interviewId, runId, cursorRef\.current\)/);
});

test("refreshes and authority-changing mutations advance one latest-request epoch", () => {
  const source = readFileSync(new URL("../../../../components/interview/agent-interview-room.tsx", import.meta.url), "utf8");
  const refresh = source.slice(source.indexOf("const refresh ="), source.indexOf("const completionPolling"));
  const submit = source.slice(source.indexOf("const sendPendingAnswer"), source.indexOf("useEffect(", source.indexOf("const sendPendingAnswer")));
  const end = source.slice(source.indexOf("const end ="), source.indexOf("const completed"));

  assert.match(source, /applyAgentRoomRefresh/);
  assert.match(source, /agentRoomRequestEpochRef/);
  assert.match(refresh, /beginAgentRoomRequest[\s\S]+fetch/);
  assert.match(submit, /beginAgentRoomRequest[\s\S]+fetch/);
  assert.match(end, /beginAgentRoomRequest[\s\S]+fetch/);
});
