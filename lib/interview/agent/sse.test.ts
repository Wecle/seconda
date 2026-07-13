import assert from "node:assert/strict";
import test from "node:test";
import type { AgentStreamEvent } from "./contracts";
import type { AgentEventWakeHub } from "./postgres-wake-hub";
import { createInMemoryInterviewAgentRepository } from "./repository";
import { encodeSseEvent, resolveReplayCursor, streamAgentEvents } from "./sse";

test("encodes persisted events with sequence ids", () => {
  assert.equal(encodeSseEvent({
    type: "warning",
    sequence: 3,
    payload: { message: "warn" },
  }), 'id: 3\nevent: warning\ndata: {"message":"warn"}\n\n');
});

test("honors EventSource Last-Event-ID on automatic reconnect", () => {
  assert.equal(resolveReplayCursor(2, 7), 7);
  assert.equal(resolveReplayCursor(9, 4), 9);
});

test("replays ordered events after a cursor and closes after terminal", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  await repository.appendEvent(run.id, { type: "checkpoint", payload: { private: true } });
  await repository.appendEvent(run.id, {
    type: "reasoning_delta",
    visibility: "public",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    payload: {
      runId: run.id,
      attemptId: "attempt-1",
      entryId: "reasoning:attempt-1",
      text: "正在核对回答证据。",
    },
  });
  await repository.completeRun(run.id, "completed");
  const events = [];
  for await (const event of streamAgentEvents({
    repository,
    wakeHub: timeoutWakeHub(),
    runId: run.id,
    afterSequence: 0,
    signal: new AbortController().signal,
  })) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["reasoning_delta", "run_completed"]);
});

test("queries immediately after notify and falls back after 1500ms", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "sse-wake" });
  const controller = new AbortController();
  const waits: number[] = [];
  const wakeHub = {
    async waitForRun(_runId: string, _after: number, _signal: AbortSignal, timeoutMs: number) {
      waits.push(timeoutMs);
      await repository.appendEvent(run.id, {
        type: "reasoning_delta",
        visibility: "public",
        attemptId: "a1",
        logicalMessageId: "m1",
        payload: {
          runId: run.id,
          attemptId: "a1",
          entryId: "reasoning:a1",
          text: "分析",
        },
      });
      return "notified" as const;
    },
  };
  const received: AgentStreamEvent[] = [];
  for await (const event of streamAgentEvents({
    repository,
    wakeHub,
    runId: run.id,
    afterSequence: 0,
    signal: controller.signal,
    fallbackMs: 1_500,
    heartbeatMs: 30_000,
  })) {
    if (event.type === "heartbeat") continue;
    received.push(event);
    break;
  }
  assert.deepEqual(received.map((event) => event.type), ["reasoning_delta"]);
  assert.deepEqual(waits, [1_500]);
});

test("emits a non-persisted heartbeat after fallback timeouts", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  let now = 0;
  const controller = new AbortController();
  const events = [];
  const wakeHub: AgentEventWakeHub = {
    async waitForRun(_runId, _afterSequence, _signal, timeoutMs) {
      assert.equal(timeoutMs, 1_500);
      now += timeoutMs;
      return "timeout";
    },
  };
  for await (const event of streamAgentEvents({
    repository,
    wakeHub,
    runId: run.id,
    afterSequence: 0,
    signal: controller.signal,
    now: () => new Date(now),
    fallbackMs: 1_500,
    heartbeatMs: 3_000,
  })) {
    events.push(event);
    controller.abort();
  }
  assert.equal(events[0].type, "heartbeat");
  assert.equal("sequence" in events[0], false);
  assert.deepEqual(await repository.listEvents(run.id, 0), []);
});

test("synthesizes run_failed for an old failed run without a terminal event", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  repository.inspectRun(run.id)!.status = "failed";
  repository.inspectRun(run.id)!.exitReason = "blocking_limit";
  const events = [];
  for await (const event of streamAgentEvents({
    repository,
    wakeHub: timeoutWakeHub(),
    runId: run.id,
    afterSequence: 0,
    signal: new AbortController().signal,
  })) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["run_failed"]);
});

test("does not synthesize a terminal event when a public terminal already exists before the cursor", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "terminal" });
  await repository.completeRun(run.id, "completed");
  const terminalSequence = (await repository.getRun(run.id))!.lastEventSequence;
  const events = [];
  for await (const event of streamAgentEvents({
    repository,
    wakeHub: timeoutWakeHub(),
    runId: run.id,
    afterSequence: terminalSequence,
    signal: new AbortController().signal,
  })) events.push(event);
  assert.deepEqual(events, []);
});

test("replays a terminal committed after the initial empty replay", async () => {
  const baseRepository = createInMemoryInterviewAgentRepository();
  const run = await baseRepository.createRun({
    interviewId: "interview",
    idempotencyKey: "terminal-race",
  });
  let firstReplay = true;
  const repository = {
    ...baseRepository,
    async listEvents(...args: Parameters<typeof baseRepository.listEvents>) {
      const events = await baseRepository.listEvents(...args);
      if (firstReplay) {
        firstReplay = false;
        await baseRepository.completeRun(run.id, "completed");
      }
      return events;
    },
  };
  const events = [];
  for await (const event of streamAgentEvents({
    repository,
    wakeHub: timeoutWakeHub(),
    runId: run.id,
    afterSequence: 0,
    signal: new AbortController().signal,
  })) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["run_completed"]);
});

function timeoutWakeHub(): AgentEventWakeHub {
  return {
    async waitForRun() {
      return "timeout";
    },
  };
}
