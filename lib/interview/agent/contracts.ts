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

export const terminalRunPayloadSchema = z.object({
  runId: z.string().min(1),
  exitReason: agentExitReasonSchema,
  retryable: z.boolean(),
  userMessage: z.string().min(1).max(500),
}).strict();

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

export const textDeltaPayloadSchema = z.object({
  messageId: z.string().min(1),
  attemptId: z.string().min(1),
  text: z.string().min(1),
  provisional: z.literal(true),
}).strict();

export const messageCommittedPayloadSchema = z.object({
  messageId: z.string().min(1),
  messageSequence: z.number().int().min(1),
}).strict();

export const persistedAgentStreamEventSchema = z.object({
  type: agentEventTypeSchema,
  sequence: z.number().int().min(1),
  payload: z.unknown(),
}).strict();

export const heartbeatStreamEventSchema = z.object({
  type: z.literal("heartbeat"),
  serverTime: z.string().datetime(),
}).strict();

export const agentStreamEventSchema = z.union([
  persistedAgentStreamEventSchema,
  heartbeatStreamEventSchema,
]);

export const runLeaseSchema = z.object({
  owner: z.string().min(1),
  expiresAt: z.date(),
}).strict();

export const contextSnapshotSchema = z.object({
  cacheEpoch: z.number().int().min(0),
  throughMessageSequence: z.number().int().min(0),
  tokenEstimate: z.number().int().min(0),
  compactionLevel: z.number().int().min(1).max(3),
  summary: z.string(),
  resumeEvidenceIds: z.array(z.string()),
  activeThreads: z.array(z.object({
    category: questionCategorySchema,
    topic: z.string().min(1),
  })),
  categoryCounts: z.record(z.string(), z.number().int().min(0)).superRefine(
    (counts, context) => {
      for (const category of Object.keys(counts)) {
        if (!questionCategorySchema.safeParse(category).success) {
          context.addIssue({
            code: "custom",
            message: `Unknown question category: ${category}`,
          });
        }
      }
    },
  ),
  recentTailStartSequence: z.number().int().min(0),
}).strict();

export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentExitReason = z.infer<typeof agentExitReasonSchema>;
export type TerminalRunPayload = z.infer<typeof terminalRunPayloadSchema>;
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type InterviewMessageRole = z.infer<typeof interviewMessageRoleSchema>;
export type InterviewMessageKind = z.infer<typeof interviewMessageKindSchema>;
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export type AnswerAssessment = z.infer<typeof answerAssessmentSchema>;
export type InterviewDecision = z.infer<typeof interviewDecisionSchema>;
export type AgentModelStep = z.infer<typeof agentModelStepSchema>;
export type AgentCheckpoint = z.infer<typeof agentCheckpointSchema>;
export type TextDeltaPayload = z.infer<typeof textDeltaPayloadSchema>;
export type MessageCommittedPayload = z.infer<typeof messageCommittedPayloadSchema>;
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;
export type RunLease = z.infer<typeof runLeaseSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export type InterviewAgentState = {
  interviewId: string;
  candidateRoundCount: number;
  categoryCounts: Partial<Record<QuestionCategory, number>>;
  recentQuestions: string[];
  requestedUserEnd: boolean;
};
