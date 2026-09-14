import { z } from "zod";

export const DIMENSIONS = [
  "understanding",
  "expression",
  "logic",
  "depth",
  "authenticity",
  "reflection",
] as const;

export type ScoreDimension = (typeof DIMENSIONS)[number];

export const questionScoresSchema = z.object({
  understanding: z.number().int().min(0).max(10),
  expression: z.number().int().min(0).max(10),
  logic: z.number().int().min(0).max(10),
  depth: z.number().int().min(0).max(10),
  authenticity: z.number().int().min(0).max(10),
  reflection: z.number().int().min(0).max(10),
});

export type QuestionScores = z.infer<typeof questionScoresSchema>;

export const rootCauseTypeSchema = z.enum([
  "narrative_hoarding",
  "conflict_avoidance",
  "status_anxiety",
  "surface_framework",
  "story_first_mismatch",
  "none",
]);

export type RootCauseType = z.infer<typeof rootCauseTypeSchema>;

export const rewriteExampleSchema = z.object({
  improvedExcerpt: z.string().trim().min(1).max(2000),
  annotations: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
}).strict();

export type RewriteExample = z.infer<typeof rewriteExampleSchema>;

export const questionFeedbackSchema = z.object({
  strengths: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  improvements: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  advice: z.string().trim().min(1).max(2000),
  rootCause: rootCauseTypeSchema.optional(),
  interviewerReaction: z.string().trim().max(1000).optional(),
  rewriteExample: rewriteExampleSchema.optional(),
}).strict();

export type QuestionFeedback = z.infer<typeof questionFeedbackSchema>;

export const questionEvaluationSchema = z.object({
  scores: questionScoresSchema,
  strengths: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  improvements: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  advice: z.string().trim().min(1).max(2000),
  rootCause: rootCauseTypeSchema.optional(),
  interviewerReaction: z.string().trim().max(1000).optional(),
  rewriteExample: rewriteExampleSchema.optional(),
}).strict();

export type QuestionEvaluation = z.infer<typeof questionEvaluationSchema>;

export const dimensionAveragesSchema = z.object({
  understanding: z.number().min(0).max(10).refine((n) => Number(n.toFixed(1)) === n, { message: "Must have at most 1 decimal place" }),
  expression: z.number().min(0).max(10).refine((n) => Number(n.toFixed(1)) === n, { message: "Must have at most 1 decimal place" }),
  logic: z.number().min(0).max(10).refine((n) => Number(n.toFixed(1)) === n, { message: "Must have at most 1 decimal place" }),
  depth: z.number().min(0).max(10).refine((n) => Number(n.toFixed(1)) === n, { message: "Must have at most 1 decimal place" }),
  authenticity: z.number().min(0).max(10).refine((n) => Number(n.toFixed(1)) === n, { message: "Must have at most 1 decimal place" }),
  reflection: z.number().min(0).max(10).refine((n) => Number(n.toFixed(1)) === n, { message: "Must have at most 1 decimal place" }),
}).strict();

export const hiringSignalSchema = z.enum([
  "strong_hire",
  "hire",
  "leaning_hire",
  "leaning_no_hire",
  "no_hire",
]);

export type HiringSignal = z.infer<typeof hiringSignalSchema>;

export const hiringDecisionSchema = z.object({
  signal: hiringSignalSchema,
  confidence: z.enum(["high", "medium", "low"]),
  decisionRationale: z.string().trim().min(1).max(1000),
  keyTradeOffs: z.string().trim().min(1).max(1000),
}).strict();

export type HiringDecision = z.infer<typeof hiringDecisionSchema>;

export const differentiationRatingSchema = z.object({
  level: z.enum(["template_worker", "competent_practitioner", "differentiated_expert"]),
  summary: z.string().trim().min(1).max(600),
  earnedSecrets: z.array(z.string().trim().min(1).max(500)).max(5),
}).strict();

export type DifferentiationRating = z.infer<typeof differentiationRatingSchema>;

export const innerMonologueItemSchema = z.object({
  questionSequence: z.number().int().positive(),
  topic: z.string().trim().min(1).max(100),
  triggerQuote: z.string().trim().min(1).max(500),
  monologue: z.string().trim().min(1).max(1000),
}).strict();

export type InnerMonologueItem = z.infer<typeof innerMonologueItemSchema>;

export const redTeamChallengeSchema = z.object({
  hiddenAssumptions: z.array(z.string().trim().min(1).max(500)).max(5),
  blindSpots: z.array(z.string().trim().min(1).max(500)).max(5),
  devilsAdvocateRejectionReason: z.string().trim().min(1).max(1000),
}).strict();

export type RedTeamChallenge = z.infer<typeof redTeamChallengeSchema>;

export const priorityActionPlan72hSchema = z.object({
  immediate24h: z.string().trim().min(1).max(500),
  storybankAdjust48h: z.string().trim().min(1).max(500),
  targetedDrill72h: z.string().trim().min(1).max(500),
}).strict();

export type PriorityActionPlan72h = z.infer<typeof priorityActionPlan72hSchema>;

export const jobFitSkillAssessmentSchema = z.object({
  skillName: z.string().trim().min(1).max(100),
  category: z.enum(["must_have", "nice_to_have"]),
  evaluation: z.enum(["exceeded", "satisfied", "partially_met", "untested"]),
  evidence: z.string().trim().min(1).max(500),
}).strict();

export type JobFitSkillAssessment = z.infer<typeof jobFitSkillAssessmentSchema>;

export const jobFitAnalysisSchema = z.object({
  overallFitRating: z.enum(["strong_fit", "workable", "stretch", "gap"]),
  fitSummary: z.string().trim().min(1).max(1000),
  skillsAssessment: z.array(jobFitSkillAssessmentSchema).max(12),
  criticalGaps: z.array(z.string().trim().min(1).max(500)).max(5),
  recommendedReverseQuestions: z.array(z.string().trim().min(1).max(500)).max(5),
}).strict();

export type JobFitAnalysis = z.infer<typeof jobFitAnalysisSchema>;

export const reportSummarySchema = z.object({
  overallSummary: z.string().trim().min(1).max(2000),
  keyStrengths: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  keyImprovements: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  recommendations: z.string().trim().min(1).max(2000),
  hiringDecision: hiringDecisionSchema.optional(),
  differentiationRating: differentiationRatingSchema.optional(),
  innerMonologues: z.array(innerMonologueItemSchema).max(5).optional(),
  redTeamChallenge: redTeamChallengeSchema.optional(),
  priorityActionPlan72h: priorityActionPlan72hSchema.optional(),
  jobFitAnalysis: jobFitAnalysisSchema.optional(),
}).strict();

export type ReportSummary = z.infer<typeof reportSummarySchema>;

export function roundHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("Division by zero");
  if (numerator < 0 || denominator < 0) throw new Error("Negative numbers not supported");
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function computeQuestionOverall(scores: QuestionScores): {
  questionScoreSum: number;
  questionOverallTenths: number;
  questionOverall: number;
} {
  const parsed = questionScoresSchema.parse(scores);
  const questionScoreSum =
    parsed.understanding +
    parsed.expression +
    parsed.logic +
    parsed.depth +
    parsed.authenticity +
    parsed.reflection;

  const questionOverallTenths = roundHalfUp(questionScoreSum * 10, 6);
  const questionOverall = questionOverallTenths / 10;

  return {
    questionScoreSum,
    questionOverallTenths,
    questionOverall,
  };
}

export function validateQuestionOverall(
  overall: number | string | null | undefined,
  scores: QuestionScores,
): { valid: true; overall: number; questionOverallTenths: number } | { valid: false; reason: string } {
  if (overall === null || overall === undefined) {
    return { valid: false, reason: "Overall score is missing" };
  }
  const num = typeof overall === "string" ? Number(overall) : overall;
  if (!Number.isFinite(num) || num < 0 || num > 10) {
    return { valid: false, reason: "Overall score out of bounds or not finite" };
  }
  if (Number(num.toFixed(1)) !== num) {
    return { valid: false, reason: "Overall score must have at most 1 decimal place" };
  }
  const computed = computeQuestionOverall(scores);
  if (num !== computed.questionOverall) {
    return {
      valid: false,
      reason: `Overall score ${num} does not match computed overall ${computed.questionOverall}`,
    };
  }
  return { valid: true, overall: num, questionOverallTenths: computed.questionOverallTenths };
}

export type ScoredQuestionInput = {
  questionId: string;
  scores: QuestionScores;
  questionOverallTenths?: number;
};

export type DimensionAverages = {
  understanding: number;
  expression: number;
  logic: number;
  depth: number;
  authenticity: number;
  reflection: number;
};

export type InterviewAggregateResult =
  | {
      scoreStatus: "no_scorable_answers";
      scoredQuestionCount: 0;
      overallScore: null;
      dimensionAverages: null;
    }
  | {
      scoreStatus: "scored";
      scoredQuestionCount: number;
      overallScore: number;
      dimensionAverages: DimensionAverages;
    };

export function computeInterviewAggregates(
  scoredQuestions: readonly ScoredQuestionInput[],
): InterviewAggregateResult {
  const count = scoredQuestions.length;
  if (count === 0) {
    return {
      scoreStatus: "no_scorable_answers",
      scoredQuestionCount: 0,
      overallScore: null,
      dimensionAverages: null,
    };
  }

  const dimensionSums: Record<ScoreDimension, number> = {
    understanding: 0,
    expression: 0,
    logic: 0,
    depth: 0,
    authenticity: 0,
    reflection: 0,
  };

  let sumQuestionOverallTenths = 0;

  for (const item of scoredQuestions) {
    const scores = questionScoresSchema.parse(item.scores);
    for (const dim of DIMENSIONS) {
      dimensionSums[dim] += scores[dim];
    }
    const tenths =
      item.questionOverallTenths ?? computeQuestionOverall(scores).questionOverallTenths;
    sumQuestionOverallTenths += tenths;
  }

  const dimensionAverages = {} as DimensionAverages;
  for (const dim of DIMENSIONS) {
    const avgTenths = roundHalfUp(dimensionSums[dim] * 10, count);
    dimensionAverages[dim] = avgTenths / 10;
  }

  const interviewOverall = roundHalfUp(sumQuestionOverallTenths, count);

  return {
    scoreStatus: "scored",
    scoredQuestionCount: count,
    overallScore: interviewOverall,
    dimensionAverages,
  };
}
