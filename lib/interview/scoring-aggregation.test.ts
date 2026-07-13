import assert from "node:assert/strict";
import test from "node:test";
import { aggregateInterviewScores, calculateQuestionOverall } from "./scoring-aggregation";

test("computes equal-weight question overall with one-decimal rounding", () => {
  assert.equal(calculateQuestionOverall({ understanding: 8, expression: 7, logic: 7, depth: 6, authenticity: 8, reflection: 6 }), 7);
  assert.equal(calculateQuestionOverall({ understanding: 10, expression: 9, logic: 8, depth: 7, authenticity: 6, reflection: 5 }), 7.5);
});

test("aggregates report dimensions and interview overall deterministically", () => {
  assert.deepEqual(aggregateInterviewScores([
    { understanding: 8, expression: 7, logic: 7, depth: 6, authenticity: 8, reflection: 6, overall: 7 },
    { understanding: 9, expression: 8, logic: 8, depth: 7, authenticity: 9, reflection: 7, overall: 8 },
  ]), {
    overallScore: 75,
    dimensions: { understanding: 8.5, expression: 7.5, logic: 7.5, depth: 6.5, authenticity: 8.5, reflection: 6.5 },
  });
});
