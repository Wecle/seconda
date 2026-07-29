import { z } from "zod";

export const questionCategorySchema = z.enum([
  "introduction",
  "resume_project",
  "technical_depth",
  "problem_solving",
  "behavioral",
  "collaboration",
  "leadership",
  "career_motivation",
  "reflection",
]);

export const interviewMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);

export const interviewMessageKindSchema = z.enum([
  "opening",
  "question",
  "answer",
  "feedback",
  "finish",
  "clarification",
  "tool_result",
]);

export const coverageStatusSchema = z.enum([
  "uncovered",
  "partial",
  "sufficient",
  "exhausted",
]);

export const answerAssessmentSchema = z.object({
  completeness: z.enum(["low", "medium", "high"]),
  specificity: z.enum(["low", "medium", "high"]),
  evidenceStrength: z.enum(["weak", "partial", "strong"]),
  reflectionDepth: z.enum(["none", "surface", "deep"]),
  followUpNeeded: z.boolean(),
  missingPoints: z.array(z.string().min(1).max(200)).max(5),
  extractedEvidence: z.array(z.string().min(1).max(300)).max(5),
  publicSummary: z.string().min(1).max(500),
}).strict();

export const interviewDecisionSchema = z.object({
  action: z.enum(["ask", "finish", "clarify"]),
  category: questionCategorySchema,
  intent: z.enum(["new_topic", "follow_up", "verify_evidence"]),
  coverageTarget: z.string().trim().min(1).max(500),
  rationale: z.string().trim().min(1).max(1000),
  estimatedInformationGain: z.enum(["low", "medium", "high"]),
});

export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type InterviewMessageRole = z.infer<typeof interviewMessageRoleSchema>;
export type InterviewMessageKind = z.infer<typeof interviewMessageKindSchema>;
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export type AnswerAssessment = z.infer<typeof answerAssessmentSchema>;
export type InterviewDecision = z.infer<typeof interviewDecisionSchema>;

export type InterviewAgentState = {
  interviewId: string;
  candidateRoundCount: number;
  categoryCounts: Partial<Record<QuestionCategory, number>>;
  recentQuestions: string[];
  requestedUserEnd: boolean;
  categoryStatuses?: Partial<Record<QuestionCategory, CoverageStatus>>;
  consecutiveNoFollowUpAssessments?: number;
};
