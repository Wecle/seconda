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

export const interviewConfigSchema = z.object({
  level: z.enum(interviewLevelValues),
  type: z.enum(interviewTypeValues),
  language: z.enum(interviewLanguageValues),
  questionCount: z.number().int().min(5).max(30),
  persona: z.enum(interviewPersonaValues),
});

export type InterviewConfig = z.infer<typeof interviewConfigSchema>;
export type InterviewLevel = (typeof interviewLevelValues)[number];
export type InterviewType = (typeof interviewTypeValues)[number];
export type InterviewLanguage = (typeof interviewLanguageValues)[number];
export type InterviewPersona = (typeof interviewPersonaValues)[number];

export const defaultInterviewConfig: InterviewConfig = {
  level: "Mid",
  type: "technical",
  language: "en",
  questionCount: 15,
  persona: "standard",
};

export function normalizeInterviewConfig(value: unknown): InterviewConfig | null {
  const parsed = interviewConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
