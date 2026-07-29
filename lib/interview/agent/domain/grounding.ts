import { z } from "zod";

export const groundedClaimSchema = z.object({
  text: z.string().trim().min(1).max(200),
  sourceIds: z.array(z.string().min(1)).min(1).max(5),
}).strict();

export const acknowledgementSchema = z.string().trim().max(600).default("");
export const candidatePromptSchema = z.string().trim().min(1).max(500);
export const groundedClaimsSchema = z.array(groundedClaimSchema).max(10).default([]);

export const groundedResponsePlanSchema = z.object({
  acknowledgement: acknowledgementSchema,
  question: candidatePromptSchema,
  claims: groundedClaimsSchema,
}).strict();

export type GroundedResponsePlan = z.infer<typeof groundedResponsePlanSchema>;

export function composeCandidateResponse(
  plan: Pick<GroundedResponsePlan, "acknowledgement" | "question">,
) {
  return [plan.acknowledgement, plan.question].filter(Boolean).join("\n\n");
}
