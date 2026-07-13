import assert from "node:assert/strict";
import test from "node:test";
import { interviewReportSchema, scoreResultSchema } from "./schemas";

const scoreResult = {
  scores: { understanding: 8, expression: 7, logic: 7, depth: 6, authenticity: 8, reflection: 6 },
  strengths: ["结构清晰"],
  improvements: ["补充结果证据"],
  advice: ["用量化结果收束回答"],
  deepDive: {
    coreConcepts: { items: [] },
    pitfalls: [],
    modelAnswer: { steps: [] },
  },
};

test("formal score schema accepts only six raw dimensions and bounded feedback", () => {
  assert.equal(scoreResultSchema.safeParse(scoreResult).success, true);
  assert.equal(scoreResultSchema.safeParse({
    ...scoreResult,
    scores: { ...scoreResult.scores, overall: 10 },
  }).success, false);
  assert.equal(scoreResultSchema.safeParse({
    ...scoreResult,
    strengths: ["a", "b", "c", "d"],
  }).success, false);
});

test("report model schema contains narrative fields but no aggregates", () => {
  const narrative = {
    topStrengths: ["结构清晰", "证据具体"],
    criticalFocus: ["加强反思"],
    summary: "整体表现稳定。",
    nextSteps: ["练习 STAR 结构"],
  };
  assert.equal(interviewReportSchema.safeParse(narrative).success, true);
  assert.equal(interviewReportSchema.safeParse({ ...narrative, overallScore: 100 }).success, false);
});
