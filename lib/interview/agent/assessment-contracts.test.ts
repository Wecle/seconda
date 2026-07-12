import assert from "node:assert/strict";
import test from "node:test";
import { answerAssessmentSchema } from "./contracts";

test("accepts a bounded decision-time assessment without scores", () => {
  const result = answerAssessmentSchema.parse({
    completeness: "medium",
    specificity: "high",
    evidenceStrength: "partial",
    reflectionDepth: "surface",
    followUpNeeded: true,
    missingPoints: ["缺少量化结果"],
    extractedEvidence: ["主导智能审批项目落地"],
    publicSummary: "回答包含项目职责，但还需要补充技术取舍和结果。",
  });
  assert.equal("overall" in result, false);
});

test("rejects formal scores and unbounded assessment text", () => {
  assert.equal(answerAssessmentSchema.safeParse({
    completeness: "high",
    specificity: "high",
    evidenceStrength: "strong",
    reflectionDepth: "deep",
    followUpNeeded: false,
    missingPoints: [],
    extractedEvidence: [],
    publicSummary: "x".repeat(501),
    overall: 9,
  }).success, false);
});
