import { z } from "zod";

export const openingStageSchema = z.enum([
  "role_resolution",
  "awaiting_role_clarification",
  "formal_interview",
]);

export const questionPurposeSchema = z.enum([
  "opening_clarification",
  "formal",
]);

export const agentRunModeSchema = z.enum([
  "opening",
  "opening_clarification",
  "answer",
]);

const evidenceIdsSchema = z.array(z.string().min(1)).max(20);
const roleValueSchema = z.string().trim().min(1).max(200);

export const needsClarificationRoleResolutionSchema = z.object({
  status: z.literal("needs_clarification"),
  confidence: z.literal("low"),
  resumeEvidenceIds: evidenceIdsSchema,
}).strict();

export const inferredRoleResolutionSchema = z.object({
  status: z.literal("inferred"),
  value: roleValueSchema,
  confidence: z.enum(["medium", "high"]),
  resumeEvidenceIds: evidenceIdsSchema,
}).strict();

export const confirmedRoleResolutionSchema = z.object({
  status: z.literal("confirmed"),
  value: roleValueSchema,
  confidence: z.literal("high"),
  resumeEvidenceIds: evidenceIdsSchema,
}).strict();

export const roleResolutionSchema = z.discriminatedUnion("status", [
  needsClarificationRoleResolutionSchema,
  inferredRoleResolutionSchema,
  confirmedRoleResolutionSchema,
]);

export type OpeningStage = z.infer<typeof openingStageSchema>;
export type QuestionPurpose = z.infer<typeof questionPurposeSchema>;
export type AgentRunMode = z.infer<typeof agentRunModeSchema>;
export type RoleResolution = z.infer<typeof roleResolutionSchema>;

export function isConfirmedRoleGrounded(
  value: string,
  clarificationAnswer: string,
) {
  const normalize = (text: string) => text
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
  const normalizedValue = normalize(value);
  return normalizedValue.length > 0
    && normalize(clarificationAnswer).includes(normalizedValue);
}
