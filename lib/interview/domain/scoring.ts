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

export const questionFeedbackSchema = z.object({
  strengths: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  improvements: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  advice: z.string().trim().min(1).max(2000),
}).strict();

export type QuestionFeedback = z.infer<typeof questionFeedbackSchema>;

export const questionEvaluationSchema = z.object({
  scores: questionScoresSchema,
  strengths: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  improvements: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  advice: z.string().trim().min(1).max(2000),
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

export const reportSummarySchema = z.object({
  overallSummary: z.string().trim().min(1).max(2000),
  keyStrengths: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  keyImprovements: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  recommendations: z.string().trim().min(1).max(2000),
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
