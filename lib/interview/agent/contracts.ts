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
  "provider_failed",
  "terminal_action_failed",
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

export const agentEventVisibilitySchema = z.enum(["public", "internal"]);

export const agentEventTypeSchema = z.enum([
  "run_started",
  "phase_changed",
  "attempt_started",
  "attempt_discarded",
  "thinking_started",
  "thinking_summary",
  "reasoning_started",
  "reasoning_delta",
  "reasoning_completed",
  "proposal_authorized",
  "response_started",
  "response_delta",
  "response_finished",
  "response_discarded",
  "artifact_committed",
  "scoring_progress",
  "reporting_started",
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

export type AgentEventType = z.infer<typeof agentEventTypeSchema>;

export const publicAgentEventTypes = [
  "run_started",
  "phase_changed",
  "attempt_started",
  "attempt_discarded",
  "reasoning_started",
  "reasoning_delta",
  "reasoning_completed",
  "tool_call_started",
  "tool_call_completed",
  "proposal_authorized",
  "response_started",
  "response_delta",
  "response_finished",
  "response_discarded",
  "artifact_committed",
  "scoring_progress",
  "reporting_started",
  "message_committed",
  "run_completed",
  "run_failed",
] as const satisfies readonly AgentEventType[];

export const publicAgentEventTypeSchema = z.enum(publicAgentEventTypes);
export type PublicAgentEventType = (typeof publicAgentEventTypes)[number];

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

export const agentProviderStepSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.unknown(),
});

export const agentModelStepSchema = z.discriminatedUnion("type", [
  agentProviderStepSchema,
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
  phase: z.enum(["assessing", "planning", "terminal", "acting"]).optional(),
  terminalAttemptCount: z.number().int().min(0).max(3).optional(),
  phaseProgressId: z.string().optional(),
  modelCallCount: z.number().int().min(0).optional(),
  invalidModelActionCount: z.number().int().min(0).optional(),
  runtimeMessages: z.array(z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
  }).strict()).optional(),
  pendingToolCall: agentProviderStepSchema.optional(),
});

export const textDeltaPayloadSchema = z.object({
  runId: z.string().min(1),
  messageId: z.string().min(1),
  attemptId: z.string().min(1),
  text: z.string().min(1),
  provisional: z.literal(true),
}).strict();

export const runStartedPayloadSchema = z.object({
  runId: z.string().min(1),
  logicalMessageId: z.string().min(1).nullable(),
}).strict();

export const publicAgentPhaseSchema = z.enum([
  "accepted",
  "reasoning",
  "tool_running",
  "proposal_streaming",
  "authorized",
  "responding",
  "validating",
  "committing",
  "repairing",
  "acting",
  "scoring",
  "reporting",
]);

export const phaseChangedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1).nullable(),
  phase: publicAgentPhaseSchema,
}).strict();

export const attemptStartedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
}).strict();

export const attemptDiscardedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  reason: z.string().min(1).max(100),
}).strict();

const reasoningLifecyclePayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  entryId: z.string().min(1).max(200),
}).strict();

export const reasoningStartedPayloadSchema = reasoningLifecyclePayloadSchema;

export const reasoningDeltaPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  entryId: z.string().min(1).max(200),
  text: z.string().min(1),
}).strict();

export const reasoningCompletedPayloadSchema = reasoningLifecyclePayloadSchema;

const toolCallLifecyclePayloadBaseSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.enum([
    "get_resume_evidence",
    "get_interview_history",
    "get_coverage_state",
  ]),
  publicLabel: z.string().min(1).max(100),
});

export const toolCallStartedPayloadSchema = toolCallLifecyclePayloadBaseSchema.strict();
export const toolCallCompletedPayloadSchema = toolCallLifecyclePayloadBaseSchema.strict();

export const proposalAuthorizedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const responseStartedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
}).strict();

export const responseDeltaPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  text: z.string().min(1),
  provisional: z.literal(true),
}).strict();

export const responseFinishedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  characterCount: z.number().int().min(0),
}).strict();

export const responseDiscardedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  reason: z.string().min(1).max(100),
}).strict();

export const thinkingSummaryPayloadSchema = z.object({
  runId: z.string().min(1),
  entryId: z.string().min(1).max(200),
  stage: z.enum(["assessment", "evidence", "coverage", "planning", "scoring", "reporting"]),
  summary: z.string().min(1).max(500),
}).strict();

export const artifactCommittedPayloadSchema = z.object({
  runId: z.string().min(1),
  artifactId: z.string().min(1).max(200),
  type: z.enum(["answer_extracted", "resume_evidence_linked", "background_saved", "coverage_updated", "direction_updated", "scoring_created", "reporting_started"]),
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  details: z.array(z.string().min(1).max(300)).max(10).default([]),
}).strict();

export const scoringProgressPayloadSchema = z.object({
  runId: z.string().min(1),
  total: z.number().int().min(0),
  pending: z.number().int().min(0),
  scoring: z.number().int().min(0),
  scored: z.number().int().min(0),
  failed: z.number().int().min(0),
}).strict();

export const reportingStartedPayloadSchema = z.object({
  runId: z.string().min(1),
}).strict();

export const committedInterviewMessageSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(1),
  role: z.literal("assistant"),
  kind: z.enum(["opening", "question", "finish", "clarification"]),
  content: z.string().min(1),
}).strict();

export const messageCommittedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  message: committedInterviewMessageSchema,
}).strict();

export const publicAgentEventPayloadSchemas = {
  run_started: runStartedPayloadSchema,
  phase_changed: phaseChangedPayloadSchema,
  attempt_started: attemptStartedPayloadSchema,
  attempt_discarded: attemptDiscardedPayloadSchema,
  reasoning_started: reasoningStartedPayloadSchema,
  reasoning_delta: reasoningDeltaPayloadSchema,
  reasoning_completed: reasoningCompletedPayloadSchema,
  tool_call_started: toolCallStartedPayloadSchema,
  tool_call_completed: toolCallCompletedPayloadSchema,
  proposal_authorized: proposalAuthorizedPayloadSchema,
  response_started: responseStartedPayloadSchema,
  response_delta: responseDeltaPayloadSchema,
  response_finished: responseFinishedPayloadSchema,
  response_discarded: responseDiscardedPayloadSchema,
  artifact_committed: artifactCommittedPayloadSchema,
  scoring_progress: scoringProgressPayloadSchema,
  reporting_started: reportingStartedPayloadSchema,
  message_committed: messageCommittedPayloadSchema,
  run_completed: terminalRunPayloadSchema,
  run_failed: terminalRunPayloadSchema,
} as const satisfies Record<PublicAgentEventType, z.ZodType>;

export const agentEventRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(1),
  type: agentEventTypeSchema,
  visibility: agentEventVisibilitySchema,
  attemptId: z.string().min(1).nullable(),
  logicalMessageId: z.string().min(1).nullable(),
  payload: z.unknown().nonoptional(),
  createdAt: z.string().datetime(),
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
export type AgentEventVisibility = z.infer<typeof agentEventVisibilitySchema>;
export type AgentEventRecord = z.infer<typeof agentEventRecordSchema>;
export type AgentEventInput = Omit<
  AgentEventRecord,
  "id" | "runId" | "sequence" | "visibility" | "attemptId" | "logicalMessageId" | "createdAt"
> & {
  visibility?: AgentEventVisibility;
  attemptId?: string | null;
  logicalMessageId?: string | null;
  dedupeKey?: string;
};
export type InterviewMessageRole = z.infer<typeof interviewMessageRoleSchema>;
export type InterviewMessageKind = z.infer<typeof interviewMessageKindSchema>;
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export type AnswerAssessment = z.infer<typeof answerAssessmentSchema>;
export type InterviewDecision = z.infer<typeof interviewDecisionSchema>;
export type AgentModelStep = z.infer<typeof agentModelStepSchema>;
export type AgentCheckpoint = z.infer<typeof agentCheckpointSchema>;
export type TextDeltaPayload = z.infer<typeof textDeltaPayloadSchema>;
export type MessageCommittedPayload = z.infer<typeof messageCommittedPayloadSchema>;
export type PublicThinkingEntry = z.infer<typeof thinkingSummaryPayloadSchema>;
export type CommittedArtifact = z.infer<typeof artifactCommittedPayloadSchema>;
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;
export type RunLease = z.infer<typeof runLeaseSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export type InterviewAgentState = {
  interviewId: string;
  candidateRoundCount: number;
  categoryCounts: Partial<Record<QuestionCategory, number>>;
  recentQuestions: string[];
  requestedUserEnd: boolean;
  categoryStatuses?: Partial<Record<QuestionCategory, CoverageStatus>>;
  consecutiveNoFollowUpAssessments?: number;
};
