import { createHash } from "node:crypto";
import { z } from "zod";
import type { ParsedResume } from "@/lib/resume/types";

export const createInterviewRequestSchema = z.object({
  resumeVersionId: z.string().uuid(),
  language: z.enum(["zh", "en", "es", "de"]),
  persona: z.enum(["friendly", "standard", "stressful"]),
  interviewType: z.enum(["behavioral", "technical", "mixed"]),
  targetLevel: z.enum(["Junior", "Mid", "Senior"]),
  targetRole: z.string().trim().min(1).max(100),
  preference: z.string().trim().max(1_000).default(""),
  preferenceTags: z.array(z.string().trim().min(1).max(50)).max(3).default([]),
  targetRoundCount: z.number().int().min(1).max(20),
}).strict();

export type CreateInterviewRequest = z.infer<typeof createInterviewRequestSchema>;

export const creationIdempotencyKeySchema = z.string().trim().min(1).max(200);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonical(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export type ResumeEvidenceEntry = {
  path: string;
  text: string;
};

export type ResumeEvidenceMap = Record<string, ResumeEvidenceEntry>;

export function buildResumeEvidence(parsed: ParsedResume): ResumeEvidenceMap {
  const entries: Array<[string, string]> = [];
  const add = (path: string, value: string | undefined) => {
    if (value?.trim()) entries.push([path, value.trim()]);
  };
  add("name", parsed.name);
  add("title", parsed.title);
  add("summary", parsed.summary);
  if (parsed.contact) {
    for (const [key, value] of Object.entries(parsed.contact)) {
      add(`contact.${key}`, value);
    }
  }
  parsed.skills.forEach((skill, skillIndex) => add(`skills[${skillIndex}]`, skill));
  parsed.experience.forEach((experience, experienceIndex) => {
    add(`experience[${experienceIndex}].title`, experience.title);
    add(`experience[${experienceIndex}].company`, experience.company);
    add(`experience[${experienceIndex}].period`, experience.period);
    experience.bullets.forEach((bullet, bulletIndex) => {
      add(`experience[${experienceIndex}].bullets[${bulletIndex}]`, bullet);
    });
  });
  parsed.education?.forEach((education, educationIndex) => {
    add(`education[${educationIndex}].major`, education.major);
    add(`education[${educationIndex}].degree`, education.degree);
    add(`education[${educationIndex}].school`, education.school);
    add(`education[${educationIndex}].period`, education.period);
  });
  parsed.projects?.forEach((project, projectIndex) => {
    add(`projects[${projectIndex}].name`, project.name);
    add(`projects[${projectIndex}].description`, project.description);
    project.tags?.forEach((tag, tagIndex) => add(`projects[${projectIndex}].tags[${tagIndex}]`, tag));
  });
  return Object.fromEntries(entries.map(([path, text]) => [
    `ev_${createHash("sha256").update(path).digest("hex").slice(0, 16)}`,
    { path, text },
  ]));
}

export function createInterviewRequestHash(input: CreateInterviewRequest) {
  return hashCanonical(input);
}
