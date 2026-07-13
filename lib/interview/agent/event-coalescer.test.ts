import assert from "node:assert/strict";
import test from "node:test";

import { createEventCoalescer } from "./event-coalescer";

type TimerHandle = ReturnType<typeof setTimeout>;

function createFakeScheduler() {
  let nextHandle = 0;
  const callbacks = new Map<TimerHandle, () => void>();

  return {
    schedule(_delayMs: number, callback: () => void): TimerHandle {
      const handle = ++nextHandle as unknown as TimerHandle;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle: TimerHandle) {
      callbacks.delete(handle);
    },
    runNext() {
      const next = callbacks.entries().next().value;
      assert.ok(next, "expected a scheduled callback");
      const [handle, callback] = next;
      callbacks.delete(handle);
      callback();
    },
    get activeCount() {
      return callbacks.size;
    },
  };
}

test("flushes on punctuation, size, timer, and finalization", async () => {
  const writes: string[] = [];
  const scheduler = createFakeScheduler();
  const coalescer = createEventCoalescer({
    intervalMs: 100,
    maxChars: 8,
    write: async (text) => {
      writes.push(text);
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await coalescer.append("分析");
  assert.deepEqual(writes, []);
  assert.equal(scheduler.activeCount, 1);

  scheduler.runNext();
  await coalescer.idle();
  assert.deepEqual(writes, ["分析"]);

  await coalescer.append("候选人回答。继续");
  assert.deepEqual(writes, ["分析", "候选人回答。"]);
  assert.equal(scheduler.activeCount, 1);

  await coalescer.append("补充说明文字");
  assert.deepEqual(writes, ["分析", "候选人回答。", "继续补充说明文字"]);
  assert.equal(scheduler.activeCount, 0);

  await coalescer.append("收尾");
  assert.equal(scheduler.activeCount, 1);
  await coalescer.dispose();
  assert.deepEqual(writes, ["分析", "候选人回答。", "继续补充说明文字", "收尾"]);
  assert.equal(scheduler.activeCount, 0);
});

test("serializes concurrent writes without losing punctuation suffixes", async () => {
  const writes: string[] = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const coalescer = createEventCoalescer({
    maxChars: 2,
    write: async (text) => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await Promise.resolve();
      writes.push(text);
      activeWrites -= 1;
    },
  });

  await Promise.all([
    coalescer.append("甲。尾"),
    coalescer.append("乙"),
    coalescer.append("丙丁"),
  ]);
  await coalescer.flush();
  await coalescer.dispose();

  assert.equal(writes.join(""), "甲。尾乙丙丁");
  assert.deepEqual(writes, ["甲。", "尾乙", "丙丁"]);
  assert.equal(maximumActiveWrites, 1);
});

test("discard drops only the pending buffer and awaits enqueued writes", async () => {
  const writes: string[] = [];
  const scheduler = createFakeScheduler();
  let releaseWrite: (() => void) | undefined;
  let markWriteStarted: (() => void) | undefined;
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
  });
  const coalescer = createEventCoalescer({
    maxChars: 2,
    write: async (text) => {
      writes.push(text);
      markWriteStarted?.();
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const enqueued = coalescer.append("甲乙");
  const buffered = coalescer.append("丙");
  await writeStarted;

  let discardSettled = false;
  const discarded = coalescer.discard().then(() => {
    discardSettled = true;
  });

  await Promise.resolve();
  assert.equal(discardSettled, false);
  assert.equal(scheduler.activeCount, 0);
  releaseWrite?.();
  await Promise.all([enqueued, buffered, discarded]);
  await coalescer.dispose();

  assert.deepEqual(writes, ["甲乙"]);
  assert.equal(scheduler.activeCount, 0);
});
