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

export const agentRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
]);

export const agentExitReasonSchema = z.enum([
  "completed",
  "max_turns",
  "aborted_streaming",
  "aborted_tools",
  "hook_stopped",
  "blocking_limit",
  "prompt_too_long",
]);

export const agentEventTypeSchema = z.enum([
  "run_started",
  "model_started",
  "text_delta",
  "tool_call_started",
  "tool_call_completed",
  "warning",
  "checkpoint",
  "compacted",
  "message_committed",
  "run_completed",
  "run_failed",
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

export const interviewDecisionSchema = z.object({
  action: z.enum(["ask", "finish", "clarify"]),
  category: questionCategorySchema,
  intent: z.enum(["new_topic", "follow_up", "verify_evidence"]),
  coverageTarget: z.string().trim().min(1).max(500),
  rationale: z.string().trim().min(1).max(1000),
  estimatedInformationGain: z.enum(["low", "medium", "high"]),
});

export const agentModelStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_call"),
    callId: z.string().min(1),
    toolName: z.string().min(1),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("final"),
    content: z.string().trim().min(1),
  }),
]);

export const agentCheckpointSchema = z.object({
  turnCount: z.number().int().min(0),
  toolCallCount: z.number().int().min(0),
  lastEventSequence: z.number().int().min(0),
  progressHash: z.string(),
  activeSkillNames: z.array(z.string()),
});

export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentExitReason = z.infer<typeof agentExitReasonSchema>;
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type InterviewMessageRole = z.infer<typeof interviewMessageRoleSchema>;
export type InterviewMessageKind = z.infer<typeof interviewMessageKindSchema>;
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export type InterviewDecision = z.infer<typeof interviewDecisionSchema>;
export type AgentModelStep = z.infer<typeof agentModelStepSchema>;
export type AgentCheckpoint = z.infer<typeof agentCheckpointSchema>;

export type InterviewAgentState = {
  interviewId: string;
  candidateRoundCount: number;
  categoryCounts: Partial<Record<QuestionCategory, number>>;
  recentQuestions: string[];
  requestedUserEnd: boolean;
};
