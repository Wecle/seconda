import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateMessageRequestSchema,
  createAgentInterviewRequestSchema,
} from "./api-contracts";

test("accepts the strict v2 creation contract", () => {
  assert.equal(createAgentInterviewRequestSchema.safeParse({
    resumeVersionId: "4d5e02dd-3bb4-4f0f-afb9-1ddbf4be02f9",
    configVersion: 2,
    language: "zh",
    persona: "standard",
    preference: "项目深挖",
    preferenceTags: ["project_deep_dive"],
  }).success, true);
});

test("rejects removed fixed-question fields from v2 requests", () => {
  assert.equal(createAgentInterviewRequestSchema.safeParse({
    resumeVersionId: "4d5e02dd-3bb4-4f0f-afb9-1ddbf4be02f9",
    configVersion: 2,
    language: "zh",
    persona: "standard",
    preference: "",
    preferenceTags: [],
    questionCount: 10,
  }).success, false);
});

test("requires bounded candidate content and a UUID idempotency key", () => {
  assert.equal(candidateMessageRequestSchema.safeParse({ content: "回答", idempotencyKey: "b9c23ef5-279b-4dc2-b90f-f3cc7100bde9" }).success, true);
  assert.equal(candidateMessageRequestSchema.safeParse({ content: "", idempotencyKey: "bad" }).success, false);
});
