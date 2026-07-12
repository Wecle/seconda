import assert from "node:assert/strict";
import test from "node:test";
import { createSkillCatalog, resolveRunSkills } from "./skills";

test("loads only opening skills and their required tools", () => {
  const resolved = resolveRunSkills("opening");
  assert.deepEqual(resolved.skills.map((skill) => skill.name), ["resume-grounding", "coverage-planning"]);
  assert.equal(resolved.toolNames.has("record_answer_evaluation" as never), false);
  assert.equal(resolved.toolNames.has("ask_interview_question"), true);
});

test("loads answer planning without formal scoring tools", () => {
  const resolved = resolveRunSkills("answer");
  assert.equal(resolved.skills.some((skill) => skill.name === "answer-planning"), true);
  assert.equal(resolved.toolNames.has("record_answer_evaluation" as never), false);
});

test("rejects duplicate skills and missing tool declarations", () => {
  const skill = { name: "one", version: "1", description: "test", instructions: "test", toolNames: ["missing"] };
  assert.throws(() => createSkillCatalog([skill, skill], new Set(["missing"])), /Duplicate skill/);
  assert.throws(() => createSkillCatalog([skill], new Set()), /unknown tool/);
});
