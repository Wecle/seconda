import assert from "node:assert/strict";
import test from "node:test";
import { getTaskTier } from "@/lib/ai/model-policy";
import { buildAnswerAssessmentPrompt } from "./assessment";

test("routes decision-time assessment to the fast tier", () => {
  assert.equal(getTaskTier("answer.assess"), "fast");
});

test("assessment prompt forbids scores and personality judgments", () => {
  const prompt = buildAnswerAssessmentPrompt({
    question: "介绍项目",
    answer: "我负责落地",
    category: "resume_project",
    topic: "项目",
    coverage: [],
    resumeEvidence: [],
  });
  assert.match(prompt.system, /不得输出.*分数/);
  assert.match(prompt.system, /不得评价人格/);
});
