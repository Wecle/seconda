import type {
  AgentCheckpoint,
  AgentEventInput,
  AgentEventRecord,
  AgentEventVisibility,
  AgentExitReason,
  InterviewAgentState,
  InterviewMessageKind,
} from "@/lib/interview/agent/protocols/events";
import type { TurnProposalPrefix } from "@/lib/interview/agent/domain/turn-proposal";

export const MAX_AGENT_RUN_RESUMES = 2;

export interface InterviewAgentRepository {
  createRun(input: {
    interviewId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "running"; created: boolean }>;
  appendEvent(
    runId: string,
    event: AgentEventInput,
    lease?: RunLeaseToken,
  ): Promise<{ sequence: number }>;
  getRun(runId: string): Promise<AgentRunRecord | null>;
  listEvents(
    runId: string,
    afterSequence: number,
    options?: { visibility?: AgentEventVisibility },
  ): Promise<AgentEventRecord[]>;
  claimRun(runId: string, owner: string, now: Date, leaseMs: number): Promise<{ claimed: boolean; run: AgentRunRecord | null }>;
  renewLease(runId: string, lease: RunLeaseToken, now: Date, leaseMs: number): Promise<boolean>;
  releaseLease(runId: string, lease: RunLeaseToken): Promise<boolean>;
  startAttempt(runId: string, input: {
    model: string;
    attemptId: string;
    attemptNumber: number;
    provisionalMessageId: string;
    now: Date;
  }, lease?: RunLeaseToken): Promise<void>;
  authorizeProposal(input: AuthorizeProposalInput): Promise<{
    authorized: true;
    proposalHash: string;
  }>;
  markResponseStarted(input: MarkResponseStartedInput): Promise<void>;
  commitTurnOutcome(input: CommitTurnOutcomeInput): Promise<CommittedTurnOutcome>;
  recordProviderProgress(runId: string, now: Date, lease?: RunLeaseToken): Promise<void>;
  saveRunTrigger(runId: string, trigger: AgentRunTrigger): Promise<void>;
  appendMessage(input: {
    id?: string;
    interviewId: string;
    runId: string;
    role: "user" | "assistant";
    kind: InterviewMessageKind;
    content: string;
    questionId?: string | null;
    idempotencyKey?: string;
  }): Promise<{ id: string; sequence: number }>;
  loadState(interviewId: string): Promise<InterviewAgentState>;
  saveCheckpoint(runId: string, checkpoint: AgentCheckpoint, lease?: RunLeaseToken): Promise<void>;
  terminateRun(runId: string, input: {
    exitReason: AgentExitReason;
    error?: unknown;
    retryable?: boolean;
    userMessage?: string;
  }, lease?: RunLeaseToken): Promise<{
    status: "completed" | "failed";
    eventSequence: number;
    created: boolean;
  }>;
  completeRun(runId: string, exitReason: AgentExitReason): Promise<void>;
  failRun(
    runId: string,
    exitReason: AgentExitReason,
    error: unknown,
  ): Promise<void>;
  commitQuestionOutcome(input: QuestionOutcomeInput): Promise<QuestionOutcome>;
  commitCoverageUpdate(input: CoverageUpdateInput): Promise<{ updated: true }>;
  commitFinishOutcome(input: FinishOutcomeInput): Promise<FinishOutcome>;
  markInterviewCompleting(interviewId: string): Promise<{ changed: boolean; invalidatedRunIds: string[] }>;
}

export type RunLeaseToken = {
  owner: string;
  generation: number;
};

export type AuthorizeProposalInput = {
  runId: string;
  lease: RunLeaseToken;
  attemptId: string;
  logicalMessageId: string;
  proposal: TurnProposalPrefix;
  proposalHash: string;
  checkpoint: AgentCheckpoint;
  authorizedAt?: Date;
};

export type MarkResponseStartedInput = {
  runId: string;
  lease: RunLeaseToken;
  attemptId: string;
  logicalMessageId: string;
  proposalHash: string;
  startedAt?: Date;
};

export type CommitTurnOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease: RunLeaseToken;
  logicalMessageId: string;
  attemptId: string;
  answerMessageId: string | null;
  proposal: TurnProposalPrefix;
  proposalHash: string;
  responseText: string;
  language: "zh" | "en" | "es" | "de";
};

export type CommittedTurnOutcome = {
  messageId: string;
  messageSequence: number;
  responseText: string;
  message: {
    id: string;
    runId: string;
    sequence: number;
    role: "assistant";
    kind: "question" | "finish" | "clarification";
    content: string;
  };
  committedEventSequence: number;
  committed: true;
};

export type QuestionOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  category: string;
  topic: string;
  question: string;
  responseText: string;
  resumeEvidenceIds: string[];
  provisionalMessageId?: string;
  targetRole?: {
    value: string;
    status: "inferred" | "confirmed";
    confidence: "low" | "medium" | "high";
    sourceIds: string[];
  };
};

export type QuestionOutcome = {
  questionId: string;
  messageId: string;
  messageSequence: number;
  responseText: string;
  committed: true;
};

export type CoverageUpdateInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  category: string;
  topic: string;
  status: string;
  resumeEvidenceIds: string[];
};

export type FinishOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  closingMessage: string;
};

export type FinishOutcome = {
  messageId: string;
  messageSequence: number;
  responseText: string;
  committed: true;
};

export type AgentRunRecord = {
  id: string;
  interviewId: string;
  status: "running" | "completed" | "failed";
  phase?: AgentRunPhase;
  attemptId: string | null;
  attemptNumber?: number;
  provisionalMessageId: string | null;
  exitReason: AgentExitReason | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseGeneration: number;
  resumeCount: number;
  nextResumeAt: Date | null;
  checkpoint: AgentCheckpoint | null;
  trigger: AgentRunTrigger | null;
  lastEventSequence: number;
};

export type AgentRunPhase =
  | "accepted"
  | "reasoning"
  | "tool_running"
  | "proposal_streaming"
  | "authorized"
  | "responding"
  | "validating"
  | "committing"
  | "repairing"
  | "acting"
  | "scoring"
  | "reporting";

export type AgentRunTrigger = {
  mode: "opening" | "answer";
  instruction: string;
};

export const RECOVERABLE_RUN_EXIT_REASONS: AgentExitReason[] = [
  "aborted_streaming",
  "provider_failed",
  "prompt_too_long",
];
