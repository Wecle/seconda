import { z } from "zod";

export const groundedClaimSchema = z.object({
  text: z.string().trim().min(1).max(200),
  sourceIds: z.array(z.string().min(1)).min(1).max(5),
}).strict();

export const acknowledgementSchema = z.string().trim().max(600)
  .refine((value) => !/[？?]/.test(value), "评价中不能包含问题")
  .default("");
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
    return !isSupported(claim.text, sourceText);
  }).map((claim) => claim.text);
  const declaredSources = plan.claims.flatMap((claim) => claim.sourceIds)
    .map((id) => sources.get(id)).filter((value): value is string => Boolean(value)).join("\n");
  const unsupportedSentences = plan.acknowledgement
    ? plan.acknowledgement.split(/[。；;！!\n]+/).map((value) => value.trim()).filter(Boolean)
      .filter((sentence) => !plan.claims.some((claim) => hasSharedFactToken(sentence, claim.text)))
    : [];
  const questionNumbers = plan.question.match(/\d+(?:\.\d+)?/g) ?? [];
  const unsupportedQuestion = questionNumbers.some((number) => !declaredSources.includes(number))
    ? [plan.question]
    : [];
  const unsupported = [...new Set([...unsupportedClaims, ...unsupportedSentences, ...unsupportedQuestion])];
  return unsupported.length > 0
    ? { ok: false as const, unsupportedClaims: unsupported }
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

function isSupported(claim: string, sourceText: string) {
  if (!sourceText) return false;
  const normalizedClaim = normalize(claim);
  const normalizedSource = normalize(sourceText);
  if (normalizedSource.includes(normalizedClaim)) return true;
  const numbers = claim.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.some((number) => !sourceText.includes(number))) return false;
  const tokens = significantTokens(claim);
  return tokens.length > 0 && tokens.every((token) => normalizedSource.includes(token));
}

function hasSharedFactToken(sentence: string, claim: string) {
  const left = normalize(sentence);
  const right = normalize(claim);
  if (left.includes(right) || right.includes(left)) return true;
  const tokens = significantTokens(claim).filter((token) => token.length >= 2);
  const chineseBigrams = Array.from({ length: Math.max(0, right.length - 1) }, (_, index) => right.slice(index, index + 2));
  return tokens.some((token) => left.includes(token)) || chineseBigrams.filter((token) => left.includes(token)).length >= 2;
}

function significantTokens(value: string) {
  const latin = value.toLowerCase().match(/[a-z][a-z0-9.+#-]{2,}/g) ?? [];
  const chinese = value.match(/[\u4e00-\u9fff]{2,}/g)?.flatMap((token) => {
    if (token.length <= 4) return [token];
    return Array.from({ length: token.length - 3 }, (_, index) => token.slice(index, index + 4));
  }) ?? [];
  return [...latin, ...chinese].slice(0, 12);
}
