import { z } from "zod";

export interface GeneratedResumeDraft {
  name: string;
  targetRole: string;
  coreSkills: string;
  education: string;
  workExperience: string;
  additionalInfo: string;
}

export function normalizeSkills(raw: string): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const part of raw.split(/[,，\n]/)) {
    const skill = part.trim();
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  return skills;
}

const coreSkillsSchema = z.string().max(1_000)
  .transform(normalizeSkills)
  .refine((skills) => skills.length >= 1, "At least one skill is required")
  .refine((skills) => skills.length <= 50, "At most 50 skills are allowed")
  .refine(
    (skills) => skills.every((skill) => skill.length <= 100),
    "Each skill must be at most 100 characters",
  );

export const generatedResumeRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  locale: z.enum(["zh", "en"]),
  name: z.string().trim().max(100).default(""),
  targetRole: z.string().trim().min(1).max(100),
  coreSkills: coreSkillsSchema,
  education: z.string().trim().max(3_000).default(""),
  workExperience: z.string().trim().max(5_000).default(""),
  additionalInfo: z.string().trim().max(5_000).default(""),
}).strict();

export type GeneratedResumeInput = z.output<typeof generatedResumeRequestSchema>;
