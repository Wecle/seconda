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
  }).strict(),
  strengths: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  improvements: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  advice: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  deepDive: z.object({
    coreConcepts: z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      items: z.array(z.object({
        name: z.string(),
        description: z.string(),
      })),
    }),
    pitfalls: z.array(z.string()),
    modelAnswer: z.object({
      approach: z.string().optional(),
      steps: z.array(z.object({
        title: z.string(),
        description: z.string(),
      })),
    }),
  }),
}).strict();

export const interviewReportSchema = z.object({
  topStrengths: z.array(z.string().trim().min(1).max(300)).min(2).max(3),
  criticalFocus: z.array(z.string().trim().min(1).max(300)).min(1).max(2),
  summary: z.string().trim().min(1).max(2000),
  nextSteps: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
}).strict();

export const persistedInterviewReportSchema = interviewReportSchema.extend({
  overallScore: z.number().int().min(0).max(100),
  dimensions: z.object({
    understanding: z.number().min(0).max(10),
    expression: z.number().min(0).max(10),
    logic: z.number().min(0).max(10),
    depth: z.number().min(0).max(10),
    authenticity: z.number().min(0).max(10),
    reflection: z.number().min(0).max(10),
  }),
}).strict();

export const followUpRoundSchema = z.object({
  comment: z.string(),
  question: z.string(),
});

export const coachStartSchema = z.object({
  explanation: z.string(),
  commonMistakes: z.array(z.string()),
  practiceQuestion: z.string(),
});

export const coachEvaluateSchema = z.object({
  scores: z.object({
    understanding: z.number().int().min(0).max(10),
    expression: z.number().int().min(0).max(10),
    logic: z.number().int().min(0).max(10),
    depth: z.number().int().min(0).max(10),
    authenticity: z.number().int().min(0).max(10),
    reflection: z.number().int().min(0).max(10),
    overall: z.number().int().min(0).max(10),
  }),
  briefFeedback: z.string(),
  improvements: z.array(z.string()),
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GeneratedQuestions = z.infer<typeof generatedQuestionsSchema>;
export type ScoreResult = z.infer<typeof scoreResultSchema> & {
  scores: z.infer<typeof scoreResultSchema>["scores"] & { overall: number };
};
export type InterviewReport = z.infer<typeof persistedInterviewReportSchema>;
export type FollowUpRound = z.infer<typeof followUpRoundSchema>;
export type CoachStart = z.infer<typeof coachStartSchema>;
export type CoachEvaluate = z.infer<typeof coachEvaluateSchema>;
