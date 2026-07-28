import assert from "node:assert/strict";
import test from "node:test";
import {
  generatedResumeRequestSchema,
  normalizeSkills,
} from "./generation-contract";

test("normalizes separators, whitespace and duplicate skills", () => {
  assert.deepEqual(
    normalizeSkills(" React，TypeScript\nreact, Node.js "),
    ["React", "TypeScript", "Node.js"],
  );
});

test("accepts the smallest factual request and keeps optionals blank", () => {
  const parsed = generatedResumeRequestSchema.parse({
    idempotencyKey: "8ca42076-f973-4510-b387-f797115bf786",
    locale: "zh",
    name: "",
    targetRole: "前端工程师",
    coreSkills: "React, TypeScript",
    education: "",
    workExperience: "",
    additionalInfo: "",
  });
  assert.deepEqual(parsed.coreSkills, ["React", "TypeScript"]);
  assert.equal(parsed.education, "");
});

test("rejects unknown request fields", () => {
  assert.throws(() => generatedResumeRequestSchema.parse({
    idempotencyKey: "8ca42076-f973-4510-b387-f797115bf786",
    locale: "zh",
    name: "",
    targetRole: "前端工程师",
    coreSkills: "React",
    education: "",
    workExperience: "",
    additionalInfo: "",
    inventedExperience: "Not allowed",
  }));
});

test("rejects empty, excessive and overlong skills", () => {
  const base = {
    idempotencyKey: "8ca42076-f973-4510-b387-f797115bf786",
    locale: "en",
    name: "",
    targetRole: "Engineer",
    education: "",
    workExperience: "",
    additionalInfo: "",
  };
  assert.throws(() => generatedResumeRequestSchema.parse({ ...base, coreSkills: " , \n" }));
  assert.throws(() => generatedResumeRequestSchema.parse({
    ...base,
    coreSkills: Array.from({ length: 51 }, (_, index) => `skill-${index}`).join(","),
  }));
  assert.throws(() => generatedResumeRequestSchema.parse({
    ...base,
    coreSkills: "x".repeat(101),
  }));
});
