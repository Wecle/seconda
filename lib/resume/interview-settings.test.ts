import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

const resumeInterviewSettingsSchema = z.object({
  language: z.enum(["zh", "en", "es", "de"]),
  persona: z.enum(["friendly", "standard", "stressful"]),
  interviewType: z.enum(["behavioral", "technical", "mixed"]),
  targetLevel: z.enum(["Junior", "Mid", "Senior"]),
  targetRole: z.string().trim().max(100).optional(),
  preference: z.string().trim().max(1_000).default(""),
  preferenceTags: z.array(z.string().trim().min(1).max(50)).max(3).default([]),
  targetRoundCount: z.number().int().min(1).max(20),
});

test("resume interview settings validates complete valid settings", () => {
  const valid = {
    language: "zh",
    persona: "standard",
    interviewType: "technical",
    targetLevel: "Senior",
    targetRole: "全栈开发专家",
    preference: "重点关注微服务架构设计与高并发治理",
    preferenceTags: ["项目深挖", "技术基础"],
    targetRoundCount: 10,
  };

  const parsed = resumeInterviewSettingsSchema.safeParse(valid);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.targetRole, "全栈开发专家");
    assert.equal(parsed.data.targetRoundCount, 10);
    assert.deepEqual(parsed.data.preferenceTags, ["项目深挖", "技术基础"]);
  }
});

test("resume interview settings applies default values for optional fields", () => {
  const minimal = {
    language: "en",
    persona: "friendly",
    interviewType: "behavioral",
    targetLevel: "Junior",
    targetRoundCount: 5,
  };

  const parsed = resumeInterviewSettingsSchema.safeParse(minimal);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.preference, "");
    assert.deepEqual(parsed.data.preferenceTags, []);
  }
});

test("resume interview settings rejects invalid fields", () => {
  assert.equal(
    resumeInterviewSettingsSchema.safeParse({
      language: "fr", // invalid language
      persona: "standard",
      interviewType: "mixed",
      targetLevel: "Mid",
      targetRoundCount: 8,
    }).success,
    false,
  );

  assert.equal(
    resumeInterviewSettingsSchema.safeParse({
      language: "zh",
      persona: "aggressive", // invalid persona
      interviewType: "mixed",
      targetLevel: "Mid",
      targetRoundCount: 8,
    }).success,
    false,
  );

  assert.equal(
    resumeInterviewSettingsSchema.safeParse({
      language: "zh",
      persona: "standard",
      interviewType: "mixed",
      targetLevel: "Mid",
      targetRoundCount: 25, // exceeds max 20
    }).success,
    false,
  );

  assert.equal(
    resumeInterviewSettingsSchema.safeParse({
      language: "zh",
      persona: "standard",
      interviewType: "mixed",
      targetLevel: "Mid",
      targetRoundCount: 8,
      preferenceTags: ["a", "b", "c", "d"], // exceeds max 3
    }).success,
    false,
  );
});
