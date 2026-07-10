import assert from "node:assert/strict";
import test from "node:test";
import {
  runModelCandidates,
  type ModelErrorAction,
} from "./model-fallback";

type Attempt = { model: string; repair: boolean };

const abortError = () => Object.assign(new Error("Aborted"), { name: "AbortError" });

function createRunner(options: {
  models?: string[];
  classify?: Record<string, ModelErrorAction>;
  results: Array<unknown | Error>;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}) {
  const attempts: Attempt[] = [];
  const controller = new AbortController();
  let index = 0;

  return {
    attempts,
    controller,
    run: () =>
      runModelCandidates({
        candidates: (options.models ?? ["first/model", "second/model"]).map((model) => ({ model })),
        signal: controller.signal,
        classifyError: (error) =>
          options.classify?.[error instanceof Error ? error.message : ""] ?? "fatal",
        sleep:
          options.sleep ??
          (() => Promise.resolve()),
        random: () => 0,
        attempt: async ({ model, repair }) => {
          attempts.push({ model, repair });
          const result = options.results[index++];
          if (result instanceof Error) throw result;
          return result;
        },
      }),
  };
}

test("returns an immediate successful attempt", async () => {
  const runner = createRunner({ results: ["ok"] });
  assert.equal(await runner.run(), "ok");
  assert.deepEqual(runner.attempts, [{ model: "first/model", repair: false }]);
});

test("uses one global structured-output repair", async () => {
  const runner = createRunner({
    results: [new Error("invalid"), "fixed"],
    classify: { invalid: "repair" },
  });
  assert.equal(await runner.run(), "fixed");
  assert.deepEqual(runner.attempts, [
    { model: "first/model", repair: false },
    { model: "first/model", repair: true },
  ]);
});

test("advances after a failed repair without another repair budget", async () => {
  const runner = createRunner({
    results: [new Error("invalid"), new Error("still-invalid"), "ok"],
    classify: { invalid: "repair", "still-invalid": "repair" },
  });
  assert.equal(await runner.run(), "ok");
  assert.deepEqual(runner.attempts, [
    { model: "first/model", repair: false },
    { model: "first/model", repair: true },
    { model: "second/model", repair: false },
  ]);
});

test("retries a transient failure once on the same model", async () => {
  const sleeps: number[] = [];
  const runner = createRunner({
    results: [new Error("temporary"), "ok"],
    classify: { temporary: "transient" },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });
  assert.equal(await runner.run(), "ok");
  assert.deepEqual(sleeps, [250]);
  assert.deepEqual(runner.attempts, [
    { model: "first/model", repair: false },
    { model: "first/model", repair: false },
  ]);
});

test("preserves repair context when a repair request has a transient failure", async () => {
  const runner = createRunner({
    results: [new Error("invalid"), new Error("temporary"), "fixed"],
    classify: { invalid: "repair", temporary: "transient" },
  });
  assert.equal(await runner.run(), "fixed");
  assert.deepEqual(runner.attempts, [
    { model: "first/model", repair: false },
    { model: "first/model", repair: true },
    { model: "first/model", repair: true },
  ]);
});

test("advances after a second transient failure", async () => {
  const runner = createRunner({
    results: [new Error("temporary"), new Error("temporary"), "ok"],
    classify: { temporary: "transient" },
  });
  assert.equal(await runner.run(), "ok");
  assert.deepEqual(runner.attempts, [
    { model: "first/model", repair: false },
    { model: "first/model", repair: false },
    { model: "second/model", repair: false },
  ]);
});

test("falls back immediately when the candidate is unavailable", async () => {
  const runner = createRunner({
    results: [new Error("missing"), "ok"],
    classify: { missing: "fallback" },
  });
  assert.equal(await runner.run(), "ok");
  assert.deepEqual(runner.attempts, [
    { model: "first/model", repair: false },
    { model: "second/model", repair: false },
  ]);
});

test("stops immediately for fatal errors", async () => {
  const runner = createRunner({
    results: [new Error("fatal")],
    classify: { fatal: "fatal" },
  });
  await assert.rejects(runner.run(), /fatal/);
  assert.deepEqual(runner.attempts, [{ model: "first/model", repair: false }]);
});

test("stops when aborted during transient backoff", async () => {
  const runner = createRunner({
    results: [new Error("temporary")],
    classify: { temporary: "transient" },
    sleep: async (_milliseconds, signal) => {
      runner.controller.abort();
      if (signal.aborted) throw abortError();
    },
  });
  await assert.rejects(runner.run(), { name: "AbortError" });
  assert.deepEqual(runner.attempts, [{ model: "first/model", repair: false }]);
});

test("throws the final eligible error after exhausting candidates", async () => {
  const runner = createRunner({
    results: [new Error("missing"), new Error("temporary"), new Error("temporary")],
    classify: { missing: "fallback", temporary: "transient" },
  });
  await assert.rejects(runner.run(), /temporary/);
  assert.deepEqual(runner.attempts, [
    { model: "first/model", repair: false },
    { model: "second/model", repair: false },
    { model: "second/model", repair: false },
  ]);
});
