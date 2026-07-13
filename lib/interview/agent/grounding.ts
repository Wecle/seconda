import { z } from "zod";

export const groundedClaimSchema = z.object({
  text: z.string().trim().min(1).max(200),
  sourceIds: z.array(z.string().min(1)).min(1).max(5),
}).strict();

export const acknowledgementSchema = z.string().trim().max(600)
  .refine((value) => !/[？?]/.test(value), "评价中不能包含问题")
  .default("");
export const singleQuestionSchema = z.string().trim().min(1).max(500)
  .refine(hasExactlyOneQuestion, "必须只包含一个问题");
export const groundedClaimsSchema = z.array(groundedClaimSchema).max(10).default([]);

export const groundedResponsePlanSchema = z.object({
  acknowledgement: acknowledgementSchema,
  question: singleQuestionSchema,
  claims: groundedClaimsSchema,
}).strict();

export type GroundedResponsePlan = z.infer<typeof groundedResponsePlanSchema>;

export function composeCandidateResponse(
  plan: Pick<GroundedResponsePlan, "acknowledgement" | "question">,
) {
  return [plan.acknowledgement, plan.question].filter(Boolean).join("\n\n");
}

function hasExactlyOneQuestion(value: string) {
  const matches = value.match(/[？?]/g);
  return matches?.length === 1 && /[？?]\s*$/.test(value);
}
