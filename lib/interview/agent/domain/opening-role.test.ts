import assert from "node:assert/strict";
import test from "node:test";

import {
  isConfirmedRoleGrounded,
  openingStageSchema,
  questionPurposeSchema,
  roleResolutionSchema,
} from "@/lib/interview/agent/domain/opening-role";

test("accepts only persisted opening stages and question purposes", () => {
  assert.deepEqual(openingStageSchema.options, [
    "role_resolution",
    "awaiting_role_clarification",
    "formal_interview",
  ]);
  assert.deepEqual(questionPurposeSchema.options, [
    "opening_clarification",
    "formal",
  ]);
});

test("parses only legal role-resolution confidence combinations", () => {
  assert.equal(roleResolutionSchema.safeParse({
    status: "needs_clarification",
    confidence: "low",
    resumeEvidenceIds: [],
  }).success, true);
  assert.equal(roleResolutionSchema.safeParse({
    status: "inferred",
    value: "Frontend Engineer",
    confidence: "high",
    resumeEvidenceIds: ["resume:structured"],
  }).success, true);
  assert.equal(roleResolutionSchema.safeParse({
    status: "confirmed",
    value: "Frontend Engineer",
    confidence: "high",
    resumeEvidenceIds: [],
  }).success, true);
  assert.equal(roleResolutionSchema.safeParse({
    status: "inferred",
    value: " ",
    confidence: "low",
    resumeEvidenceIds: [],
  }).success, false);
  assert.equal(roleResolutionSchema.safeParse({
    status: "confirmed",
    value: "Frontend Engineer",
    confidence: "medium",
    resumeEvidenceIds: [],
  }).success, false);
  assert.equal(roleResolutionSchema.safeParse({
    status: "needs_clarification",
    value: "Engineer",
    confidence: "low",
    resumeEvidenceIds: [],
  }).success, false);
  assert.equal(roleResolutionSchema.safeParse({
    status: "needs_clarification",
    confidence: "low",
    resumeEvidenceIds: Array.from({ length: 21 }, (_, index) => `e:${index}`),
  }).success, false);
});

test("grounds a confirmed role in the persisted clarification answer", () => {
  assert.equal(
    isConfirmedRoleGrounded(
      "Frontend Engineer",
      "I am targeting frontend-engineer roles.",
    ),
    true,
  );
  assert.equal(
    isConfirmedRoleGrounded("前端工程师", "我的目标是前端工程师。"),
    true,
  );
  assert.equal(
    isConfirmedRoleGrounded(
      "Product Manager",
      "I am targeting frontend roles.",
    ),
    false,
  );
});
