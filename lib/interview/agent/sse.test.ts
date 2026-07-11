import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "./repository";
import { encodeSseEvent, pollAgentEvents, resolveReplayCursor } from "./sse";

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
  await repository.appendEvent(run.id, { type: "run_started", payload: {} });
  await repository.appendEvent(run.id, { type: "warning", payload: { message: "warn" } });
  await repository.completeRun(run.id, "completed");
  const events = [];
  for await (const event of pollAgentEvents({
    repository,
    runId: run.id,
    afterSequence: 1,
    signal: new AbortController().signal,
  })) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["warning"]);
});

test("emits a non-persisted heartbeat after ten idle seconds", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  let now = 0;
  const controller = new AbortController();
  const events = [];
  for await (const event of pollAgentEvents({
    repository,
    runId: run.id,
    afterSequence: 0,
    signal: controller.signal,
    now: () => new Date(now),
    wait: async () => { now += 5_000; },
    heartbeatMs: 10_000,
  })) {
    events.push(event);
    controller.abort();
  }
  assert.equal(events[0].type, "heartbeat");
  assert.equal("sequence" in events[0], false);
  assert.deepEqual(await repository.listEvents(run.id, 0), []);
});
