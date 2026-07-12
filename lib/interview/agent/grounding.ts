import { z } from "zod";

export const groundedClaimSchema = z.object({
  text: z.string().trim().min(1).max(200),
  sourceIds: z.array(z.string().min(1)).min(1).max(5),
}).strict();

export const acknowledgementSchema = z.string().trim().max(600).default("");
export const singleQuestionSchema = z.string().trim().min(1).max(500).refine(hasExactlyOneQuestion, "必须只包含一个问题");
export const groundedClaimsSchema = z.array(groundedClaimSchema).max(10).default([]);

export const groundedResponsePlanSchema = z.object({
  acknowledgement: acknowledgementSchema,
  question: singleQuestionSchema,
  claims: groundedClaimsSchema,
}).strict().superRefine((value, context) => {
  if (value.acknowledgement && value.claims.length === 0) {
    context.addIssue({ code: "custom", path: ["claims"], message: "评价中的事实必须提供来源" });
  }
});

export type GroundedResponsePlan = z.infer<typeof groundedResponsePlanSchema>;

export function validateGroundedClaims(
  plan: GroundedResponsePlan,
  sources: ReadonlyMap<string, string>,
) {
  const unsupportedClaims = plan.claims.filter((claim) => {
    const sourceText = claim.sourceIds.map((id) => sources.get(id)).filter(Boolean).join("\n");
    if (!sourceText) return true;
    const normalizedClaim = normalize(claim.text);
    const normalizedSource = normalize(sourceText);
    if (normalizedSource.includes(normalizedClaim)) return false;
    const numbers = claim.text.match(/\d+(?:\.\d+)?/g) ?? [];
    if (numbers.some((number) => !sourceText.includes(number))) return true;
    const tokens = significantTokens(claim.text);
    return tokens.length === 0 || !tokens.every((token) => normalizedSource.includes(token));
  }).map((claim) => claim.text);
  return unsupportedClaims.length > 0
    ? { ok: false as const, unsupportedClaims }
    : { ok: true as const };
}

export function composeCandidateResponse(plan: Pick<GroundedResponsePlan, "acknowledgement" | "question">) {
  return [plan.acknowledgement, plan.question].filter(Boolean).join("\n\n");
}

function hasExactlyOneQuestion(value: string) {
  const matches = value.match(/[？?]/g);
  return matches?.length === 1 && /[？?]\s*$/.test(value);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s，。、“”‘’：；（）()\-_/]/g, "");
}

function significantTokens(value: string) {
  const latin = value.toLowerCase().match(/[a-z][a-z0-9.+#-]{2,}/g) ?? [];
  const chinese = value.match(/[\u4e00-\u9fff]{2,}/g)?.flatMap((token) => {
    if (token.length <= 4) return [token];
    return Array.from({ length: token.length - 3 }, (_, index) => token.slice(index, index + 4));
  }) ?? [];
  return [...latin, ...chinese].slice(0, 12);
}
