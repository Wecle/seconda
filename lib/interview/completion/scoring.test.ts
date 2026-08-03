import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createCompletionScoreTelemetryContext,
  mapWithConcurrency,
} from "./scoring";
import { createCompletionReportTelemetryContext } from "../report-completion";

test("formal scoring never exceeds three concurrent calls", async () => {
  let active = 0;
  let maximum = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });
  assert.equal(maximum, 3);
});

test("completion scoring and reporting share one deterministic budget scope", () => {
  const interviewId = "00000000-0000-4000-8000-000000000001";
  const jobId = "00000000-0000-4000-8000-000000000002";
  const questionId = "00000000-0000-4000-8000-000000000003";
  assert.deepEqual(createCompletionScoreTelemetryContext({
    interviewId,
    jobId,
    questionId,
  }), {
    operationKey: `answer.score:${jobId}:${questionId}`,
    interviewId,
    questionId,
    completionJobId: jobId,
    budgetScope: `completion:${jobId}`,
  });
  assert.deepEqual(createCompletionReportTelemetryContext({ interviewId, jobId }), {
    operationKey: `report.generate:${jobId}`,
    interviewId,
    completionJobId: jobId,
    budgetScope: `completion:${jobId}`,
  });
});

test("zero-answer completion returns before report model telemetry is created", async () => {
  const source = await readFile(
    new URL("../report-completion.ts", import.meta.url),
    "utf8",
  );
  const zeroAnswerBranch = source.indexOf("if (answeredCount === 0)");
  const providerCall = source.indexOf("await generateInterviewReport");
  assert.ok(zeroAnswerBranch >= 0);
  assert.ok(providerCall > zeroAnswerBranch);
  assert.match(source.slice(zeroAnswerBranch, providerCall), /return report;/);
  assert.doesNotMatch(
    source.slice(zeroAnswerBranch, providerCall),
    /createCompletionReportTelemetryContext/,
  );
});
