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

test("production composition creates one correlated telemetry task per Agent Run", async () => {
  const source = await readFile(new URL("./composition.ts", import.meta.url), "utf8");
  assert.match(source, /operationKey:\s*`interview\.agent:\$\{input\.runId\}`/);
  assert.match(source, /interviewId:\s*input\.interviewId/);
  assert.match(source, /agentRunId:\s*input\.runId/);
  assert.match(source, /budgetScope:\s*`agent_run:\$\{input\.runId\}`/);
  assert.match(source, /promptTemplateVersion:\s*promptContext\.templateVersion/);
  assert.match(source, /telemetry:\s*\{ lifecycle: telemetry, task: telemetryTask \}/);
});

test("production composition finishes telemetry without replacing the runtime result", async () => {
  const source = await readFile(new URL("./composition.ts", import.meta.url), "utf8");
  assert.match(source, /await telemetry\.completeTask\(telemetryTask\)\.catch\(\(\) => \{\}\);\s*return result/);
  assert.match(source, /await telemetry\.failTask\(telemetryTask, error\)\.catch\(\(\) => \{\}\);\s*throw error/);
});
