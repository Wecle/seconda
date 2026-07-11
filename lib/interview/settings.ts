import { z } from "zod";

export const interviewLevelValues = ["Junior", "Mid", "Senior"] as const;
export const interviewTypeValues = [
  "behavioral",
  "technical",
  "mixed",
] as const;
export const interviewLanguageValues = ["en", "zh", "es", "de"] as const;
export const interviewPersonaValues = [
  "friendly",
  "standard",
  "stressful",
] as const;
export const interviewPreferenceTagValues = [
  "project_deep_dive",
  "technical_foundations",
  "behavioral_evidence",
] as const;

export const interviewConfigV1Schema = z.object({
  configVersion: z.literal(1).default(1),
  level: z.enum(interviewLevelValues),
  type: z.enum(interviewTypeValues),
  language: z.enum(interviewLanguageValues),
  questionCount: z.number().int().min(5).max(30),
  persona: z.enum(interviewPersonaValues),
});

export const interviewConfigV2Schema = z
  .object({
    configVersion: z.literal(2),
    language: z.enum(interviewLanguageValues),
    persona: z.enum(interviewPersonaValues),
    preference: z.string().trim().max(1000),
    preferenceTags: z.array(z.enum(interviewPreferenceTagValues)).max(3),
  })
  .strict();

export const interviewConfigSchema = z.union([
  interviewConfigV1Schema,
  interviewConfigV2Schema,
]);

export type InterviewConfigV1 = z.infer<typeof interviewConfigV1Schema>;
export type InterviewConfigV2 = z.infer<typeof interviewConfigV2Schema>;
export type StoredInterviewConfig = z.infer<typeof interviewConfigSchema>;
export type InterviewConfig = InterviewConfigV1;
export type InterviewLevel = (typeof interviewLevelValues)[number];
export type InterviewType = (typeof interviewTypeValues)[number];
export type InterviewLanguage = (typeof interviewLanguageValues)[number];
export type InterviewPersona = (typeof interviewPersonaValues)[number];
export type InterviewPreferenceTag =
  (typeof interviewPreferenceTagValues)[number];

export const defaultInterviewConfig: InterviewConfigV1 = {
  configVersion: 1,
  level: "Mid",
  type: "technical",
  language: "en",
  questionCount: 15,
  persona: "standard",
};

export const defaultInterviewConfigV2: InterviewConfigV2 = {
  configVersion: 2,
  language: "zh",
  persona: "standard",
  preference: "",
  preferenceTags: [],
};

export function normalizeInterviewConfig(
  value: unknown,
): StoredInterviewConfig | null {
  const v2 = interviewConfigV2Schema.safeParse(value);
  if (v2.success) return v2.data;

  const v1 = interviewConfigV1Schema.safeParse(
    value && typeof value === "object"
      ? { ...(value as Record<string, unknown>), configVersion: 1 }
      : value,
  );
  return v1.success ? v1.data : null;
}
