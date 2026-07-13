import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemoryAgentEventWakeHub,
  parseAgentEventWake,
} from "./postgres-wake-hub";

test("wakes only the matching run and remembers the latest sequence", async () => {
  const hub = createInMemoryAgentEventWakeHub();
  const waiting = hub.waitForRun("run-a", 2, new AbortController().signal, 1_000);
  let settled = false;
  void waiting.then(() => {
    settled = true;
  });
  hub.publish({ runId: "run-b", latestSequence: 9 });
  await Promise.resolve();
  assert.equal(settled, false);
  hub.publish({ runId: "run-a", latestSequence: 3 });
  assert.equal(await waiting, "notified");
  assert.equal(
    await hub.waitForRun("run-a", 2, new AbortController().signal, 1_000),
    "notified",
  );
});

test("does not wake a waiter when the notification is not newer", async () => {
  const hub = createInMemoryAgentEventWakeHub();
  hub.publish({ runId: "run-a", latestSequence: 2 });
  assert.equal(
    await hub.waitForRun("run-a", 2, new AbortController().signal, 0),
    "timeout",
  );
});

test("returns timeout and removes the abort listener", async () => {
  const hub = createInMemoryAgentEventWakeHub();
  const controller = new AbortController();
  let active = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
    active += 1;
    return add(...args);
  }) as typeof controller.signal.addEventListener;
  controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
    active -= 1;
    return remove(...args);
  }) as typeof controller.signal.removeEventListener;

  for (let index = 0; index < 20; index += 1) {
    assert.equal(await hub.waitForRun("run-a", 0, controller.signal, 0), "timeout");
  }
  assert.equal(active, 0);
});

test("aborting a wait clears its timer and listener", async () => {
  const hub = createInMemoryAgentEventWakeHub();
  const controller = new AbortController();
  let active = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
    active += 1;
    return add(...args);
  }) as typeof controller.signal.addEventListener;
  controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
    active -= 1;
    return remove(...args);
  }) as typeof controller.signal.removeEventListener;

  const waiting = hub.waitForRun("run-a", 0, controller.signal, 30_000);
  controller.abort(new Error("closed"));
  await assert.rejects(waiting, /closed/);
  assert.equal(active, 0);
});

test("validates PostgreSQL notification payloads", () => {
  assert.deepEqual(
    parseAgentEventWake(JSON.stringify({ runId: "run-a", latestSequence: 7 })),
    { runId: "run-a", latestSequence: 7 },
  );
  assert.equal(parseAgentEventWake("not-json"), null);
  assert.equal(parseAgentEventWake(JSON.stringify({ runId: "run-a", latestSequence: "7" })), null);
  assert.equal(parseAgentEventWake(JSON.stringify({ runId: "run-a", latestSequence: 7, secret: true })), null);
});
