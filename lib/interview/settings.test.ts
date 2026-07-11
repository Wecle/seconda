import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultInterviewConfigV2,
  interviewConfigV2Schema,
  normalizeInterviewConfig,
} from "./settings";

test("accepts v2 interview preferences", () => {
  const value = interviewConfigV2Schema.parse({
    configVersion: 2,
    language: "zh",
    persona: "standard",
    preference: "重点深挖最近的项目经历",
    preferenceTags: ["project_deep_dive"],
  });

  assert.equal(value.configVersion, 2);
  assert.equal(value.preference.length > 0, true);
});

test("rejects removed fixed-question fields from v2", () => {
  assert.equal(
    interviewConfigV2Schema.safeParse({
      configVersion: 2,
      language: "zh",
      persona: "standard",
      preference: "",
      preferenceTags: [],
      questionCount: 10,
    }).success,
    false,
  );
});

test("normalizes stored v1 and v2 configurations", () => {
  assert.equal(normalizeInterviewConfig(defaultInterviewConfigV2)?.configVersion, 2);
  assert.equal(
    normalizeInterviewConfig({
      level: "Mid",
      type: "technical",
      language: "en",
      questionCount: 15,
      persona: "standard",
    })?.configVersion,
    1,
  );
});
