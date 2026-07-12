import assert from "node:assert/strict";
import test from "node:test";
import { assessmentToCoveragePatch, ensureAssessment } from "./assessment-service";
import type { AnswerAssessment } from "./contracts";

const value: AnswerAssessment = {
  completeness: "medium",
  specificity: "high",
  evidenceStrength: "partial",
  reflectionDepth: "surface",
  followUpNeeded: true,
  missingPoints: ["结果"],
  extractedEvidence: ["负责落地"],
  publicSummary: "需要继续追问结果。",
};

test("reuses a durable assessment without another model call", async () => {
  let modelCalls = 0;
  const result = await ensureAssessment({
    findExisting: async () => ({ id: "assessment-1", value }),
    assess: async () => { modelCalls += 1; return value; },
    commit: async (assessment) => ({ id: "assessment-1", value: assessment, created: true }),
  });
  assert.equal(result.created, false);
  assert.equal(modelCalls, 0);
});

test("maps assessment to coverage without formal scores", () => {
  assert.deepEqual(assessmentToCoveragePatch(value), {
    depth: 2,
    evidenceQuality: 2,
    status: "partial",
  });
  assert.equal("overall" in value, false);
});
