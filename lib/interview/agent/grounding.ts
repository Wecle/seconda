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
}).strict();

export type GroundedResponsePlan = z.infer<typeof groundedResponsePlanSchema>;

export function validateGroundedClaims(
  plan: GroundedResponsePlan & { resumeEvidenceIds?: readonly string[] },
  sources: ReadonlyMap<string, string>,
) {
  const unsupportedClaims = plan.claims.filter((claim) => {
    const sourceText = claim.sourceIds.map((id) => sources.get(id)).filter(Boolean).join("\n");
    return !isSupported(claim.text, sourceText);
  }).map((claim) => claim.text);
  const declaredSources = [
    ...plan.claims.flatMap((claim) => claim.sourceIds),
    ...(plan.resumeEvidenceIds ?? []),
  ]
    .map((id) => sources.get(id)).filter((value): value is string => Boolean(value)).join("\n");
  const unsupportedSentences = plan.acknowledgement
    ? plan.acknowledgement.split(/[。；;！!\n]+/).map((value) => value.trim()).filter(Boolean)
      .filter((sentence) => isNonFactualEvaluation(sentence)
        ? false
        : hasSensitiveAttribution(sentence)
        ? !isSupported(sentence, declaredSources)
        : !plan.claims.some((claim) => hasSharedFactToken(sentence, claim.text)))
    : [];
  const questionFacts = extractQuestionFacts(plan.question);
  const unsupportedQuestion = questionFacts.some((fact) => !isSupported(fact, declaredSources))
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
  return canonicalize(value)
    .replace(/[\s，。、、“”‘’：；（）()\-_/]/g, "");
}

function canonicalize(value: string) {
  return value.toLowerCase()
    .replace(/([一二三四五六七八九十])(?=年|人|个|秒|项|次|%|％)/g, (_, number: string) => `${chineseNumber(number)}`)
    .replace(/候选人|你|您|我|自己|提到|表示|说|说明|拥有|具备|熟悉|掌握|并且|根据简历|简历中(?:也)?有|简历中|简历上?显示|从简历(?:看|看到)|该项目使用|项目经验|等框架/g, "");
}

function chineseNumber(value: string) {
  const values: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  return values[value] ?? value;
}

function isSupported(claim: string, sourceText: string) {
  if (!sourceText) return false;
  const canonicalClaim = canonicalize(claim);
  const normalizedClaim = normalize(claim);
  const normalizedSource = normalize(sourceText);
  if (normalizedSource.includes(normalizedClaim)) return true;
  const numbers = canonicalClaim.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.some((number) => !normalizedSource.includes(number))) return false;
  const latin = canonicalClaim.match(/[a-z][a-z0-9.+#-]{2,}/g) ?? [];
  if (latin.some((token) => !normalizedSource.includes(token))) return false;
  const chinese = canonicalClaim.replace(/[^\u4e00-\u9fff]/g, "");
  const bigrams = [...new Set(Array.from(
    { length: Math.max(0, chinese.length - 1) },
    (_, index) => chinese.slice(index, index + 2),
  ))];
  const supportedBigrams = bigrams.filter((token) => normalizedSource.includes(token)).length;
  if (bigrams.length > 0) {
    return supportedBigrams >= Math.min(2, bigrams.length) &&
      supportedBigrams / bigrams.length >= 0.6;
  }
  return numbers.length > 0 || latin.length > 0;
}

function hasSharedFactToken(sentence: string, claim: string) {
  const left = normalize(sentence);
  const right = normalize(claim);
  if (left.includes(right) || right.includes(left)) return true;
  const tokens = significantTokens(claim).filter((token) => token.length >= 2);
  const chineseBigrams = Array.from({ length: Math.max(0, right.length - 1) }, (_, index) => right.slice(index, index + 2));
  return tokens.some((token) => left.includes(token)) || chineseBigrams.filter((token) => left.includes(token)).length >= 2;
}

function hasSensitiveAttribution(value: string) {
  return /\d|团队|领导|主导|负责|担任|就职|任职|获得|获奖|提升|降低|超过|达到|公司|项目|[A-Za-z][A-Za-z0-9.+#-]{2,}/.test(value);
}

function isNonFactualEvaluation(value: string) {
  return /^(?:这(?:是|听起来)|整体|你的回答|这个方向|这个思路).*(?:方向|思路|回答|表述|切入点|很有意思|比较清楚|较清楚|不够具体|需要进一步|值得深入)/.test(value);
}

function extractQuestionFacts(question: string) {
  const facts = new Set<string>();
  for (const value of question.match(/\d+(?:\.\d+)?/g) ?? []) facts.add(value);
  for (const value of question.match(/[A-Za-z][A-Za-z0-9.+#-]{2,}/g) ?? []) facts.add(value);
  const attribution = question.match(/你(?:曾)?(?:在|负责|领导|主导|担任|就职于|任职于)([^，。；？！?]{2,60}?)(?:时|期间|中)/);
  if (attribution?.[1]) {
    const premise = attribution[1].split(/时|期间|中|如何|为什么|怎样|遇到|做了什么/)[0]?.trim();
    if (premise) facts.add(premise);
  }
  return [...facts];
}

function significantTokens(value: string) {
  const latin = value.toLowerCase().match(/[a-z][a-z0-9.+#-]{2,}/g) ?? [];
  const chinese = value.match(/[\u4e00-\u9fff]{2,}/g)?.flatMap((token) => {
    if (token.length <= 4) return [token];
    return Array.from({ length: token.length - 3 }, (_, index) => token.slice(index, index + 4));
  }) ?? [];
  return [...latin, ...chinese].slice(0, 12);
}
