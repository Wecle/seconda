import assert from "node:assert/strict";
import test from "node:test";
import { runAgentAttempts } from "./attempt-controller";

test("retries transient failures twice per model then falls back", async () => {
  const calls: string[] = [];
  const delays: number[] = [];
  const result = await runAgentAttempts({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: () => "transient",
    random: () => 0.5,
    sleep: async (delay) => { delays.push(delay); },
    createId: (model, number) => `${model}-${number}`,
    onAttemptStarted: async () => {},
    attempt: async ({ model }) => {
      calls.push(model);
      if (model === "fast") throw new Error("retry");
      return "ok";
    },
  });
  assert.equal(result.value, "ok");
  assert.deepEqual(calls, ["fast", "fast", "fast", "quality"]);
  assert.deepEqual(delays, [250, 500]);
});

test("does not retry fatal errors", async () => {
  let calls = 0;
  await assert.rejects(runAgentAttempts({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    attempt: async () => { calls += 1; throw new Error("fatal"); },
  }), /fatal/);
  assert.equal(calls, 1);
});

test("never falls back after provisional content is accepted", async () => {
  const calls: string[] = [];
  await assert.rejects(runAgentAttempts({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: () => "transient",
    onAttemptStarted: async () => {},
    attempt: async ({ model, acceptProvisional }) => {
      calls.push(model);
      acceptProvisional();
      throw new Error("stream broke");
    },
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROVISIONAL_STREAM_ABORTED");
    return true;
  });
  assert.deepEqual(calls, ["fast"]);
});

test("uses full jitter capped at eight seconds", async () => {
  const delays: number[] = [];
  await assert.rejects(runAgentAttempts({
    candidates: [{ model: "fast" }],
    classifyError: () => "transient",
    random: () => 0.999,
    sleep: async (delay) => { delays.push(delay); },
    onAttemptStarted: async () => {},
    attempt: async () => { throw new Error("retry"); },
  }));
  assert.ok(delays[0] >= 0 && delays[0] < 500);
  assert.ok(delays[1] >= 0 && delays[1] < 1000);
});

test("continues attempt numbers from the persisted offset", async () => {
  const started: number[] = [];
  const result = await runAgentAttempts({
    candidates: [{ model: "fast" }],
    attemptNumberOffset: 7,
    classifyError: () => "fatal",
    createId: (_model, number) => `attempt-${number}`,
    onAttemptStarted: async ({ attemptNumber }) => {
      started.push(attemptNumber);
    },
    attempt: async ({ attemptNumber }) => attemptNumber,
  });

  assert.equal(result.value, 8);
  assert.equal(result.attemptNumber, 8);
  assert.deepEqual(started, [8]);
});
