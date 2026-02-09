import { z } from "zod";

export const generatedQuestionSchema = z.object({
  questionType: z.string(),
  topic: z.string(),
  question: z.string(),
  tip: z.string(),
});

export const generatedQuestionsSchema = z.object({
  questions: z.array(generatedQuestionSchema),
});

export const scoreResultSchema = z.object({
  scores: z.object({
    understanding: z.number().int().min(0).max(10),
    expression: z.number().int().min(0).max(10),
    logic: z.number().int().min(0).max(10),
    depth: z.number().int().min(0).max(10),
    authenticity: z.number().int().min(0).max(10),
    reflection: z.number().int().min(0).max(10),
    overall: z.number().int().min(0).max(10),
  }),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  advice: z.array(z.string()),
  deepDive: z.object({
    coreConcepts: z.array(z.object({ title: z.string(), description: z.string() })),
    commonPitfalls: z.array(z.string()),
    modelAnswerSteps: z.array(z.object({ step: z.string(), detail: z.string() })),
  }),
});

export const interviewReportSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  dimensions: z.object({
    understanding: z.number().min(0).max(10),
    expression: z.number().min(0).max(10),
    logic: z.number().min(0).max(10),
    depth: z.number().min(0).max(10),
    authenticity: z.number().min(0).max(10),
    reflection: z.number().min(0).max(10),
  }),
  topStrengths: z.array(z.string()),
  criticalFocus: z.array(z.string()),
  summary: z.string(),
  nextSteps: z.array(z.string()),
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GeneratedQuestions = z.infer<typeof generatedQuestionsSchema>;
export type ScoreResult = z.infer<typeof scoreResultSchema>;
export type InterviewReport = z.infer<typeof interviewReportSchema>;
