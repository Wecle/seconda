import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production composition has no pre-loop assessment model call", async () => {
  const source = await readFile(new URL("./composition.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ensureLatestAnswerAssessment|assessAnswer|answer\.assess/);
});

test("production composition supplies authoritative turn context", async () => {
  const source = await readFile(new URL("./composition.ts", import.meta.url), "utf8");
  assert.match(source, /turnContext:\s*promptContext\.turnContext/);
  assert.doesNotMatch(source, /publicThinkingSummary|thinkingAlreadyStarted/);
});
