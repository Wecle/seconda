import { z } from "zod";
import {
  interviewLanguageValues,
  interviewPersonaValues,
  interviewPreferenceTagValues,
} from "../settings";

export const createAgentInterviewRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  resumeVersionId: z.string().uuid(),
  configVersion: z.literal(2),
  language: z.enum(interviewLanguageValues),
  persona: z.enum(interviewPersonaValues),
  preference: z.string().trim().max(1000),
  preferenceTags: z.array(z.enum(interviewPreferenceTagValues)).max(3),
}).strict();

export const candidateMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().uuid(),
}).strict();
