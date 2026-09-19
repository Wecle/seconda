import type { ModelMessage } from "ai";

export const AGENT_EVENT_TYPES = [
  "session_forked",
  "run_started",
  "step_started",
  "step_retried",
  "assistant_chunk",
  "assistant_delta",
  "tool_called",
  "tool_completed",
  "step_completed",
  "user_message",
  "assistant_message",
  "tool_result_message",
  "model_message",
  "request_context",
  "context_pressure",
  "tool_result_spilled",
  "compaction_started",
  "compaction_summary",
  "model_context_replaced",
  "compaction_completed",
  "compaction_failed",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "skill_catalog_snapshotted",
  "skill_loaded",
  "skill_load_failed",
  "interview/session_initialized",
  "interview/question_committed",
  "interview/answer_submitted",
  "interview/answer_analyzed",
  "interview/completion_requested",
  "interview/completed",
  "interview/run_retried",
  "interview/completion_failed",
  "interview/completion_retried",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentEvent = {
  id: number;
  sessionId: string;
  runId: string | null;
  sequence: number;
  type: AgentEventType;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  schemaVersion: number;
  visibility: AgentEventVisibility;
  createdAt: Date;
};

export type AgentEventVisibility = "model" | "user" | "model_and_user" | "internal";

export type AgentSessionSummary = {
  id: string;
  title: string;
  model: string;
  status: "idle" | "running" | "failed";
  createdAt: Date;
  updatedAt: Date;
};

export type AgentEventSink = {
  append(type: AgentEventType, payload: Record<string, unknown>): Promise<AgentEvent>;
  publish?(event: AgentEvent): void;
};

export type AgentRunInput = {
  sessionId: string;
  runId: string;
  userId: string;
  capability: string;
  promptVersion: string;
  model: string;
  systemPrompt: string;
  capabilityConfig: unknown;
  skillSnapshotRunId?: string;
  modelContextBoundarySequence?: number;
  maxSteps: number;
  signal: AbortSignal;
  events: AgentEventSink;
};

export type ModelInputProjection = {
  messages: ModelMessage[];
  surfaceSequences: number[];
  ignoredSequences: number[];
};

export type ContextTrust = "trusted-instruction" | "trusted-context" | "untrusted-data";

export type ContextSection = {
  id: string;
  order: number;
  title: string;
  content: string;
  trust: ContextTrust;
};

export type ContextProviderInput = {
  model: string;
  sessionId: string;
};

export type ContextProvider = {
  id: string;
  order: number;
  provide(input: ContextProviderInput): ContextSection | ContextSection[] | Promise<ContextSection | ContextSection[]>;
};

export type TrajectoryToolCall = {
  callId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  sequence: number;
};

export type TrajectoryStep = {
  stepIndex: number;
  runId: string;
  attempt: number;
  status: "running" | "completed" | "failed" | "retried";
  startSequence: number;
  endSequence?: number;
  startedAt: Date;
  completedAt?: Date;
  reasoning?: {
    content: string;
    complete: boolean;
  };
  textDelta?: string;
  toolCalls: TrajectoryToolCall[];
  metrics?: {
    finishReason: string;
    durationMs?: number;
    firstTokenMs?: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    totalTokens: number;
  };
};

export type TrajectoryItemRole = "system" | "context" | "user" | "assistant" | "tool" | "outcome";

export type TrajectoryItem = {
  id: string;
  sequence: number;
  role: TrajectoryItemRole;
  title: string;
  preview: string;
  content: string;
  source?: string;
  status?: "completed" | "running" | "failed" | "retried";
  durationMs?: number;
  timestamp: Date;
  raw?: unknown;
  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    totalTokens?: number;
    firstTokenMs?: number;
    finishReason?: string;
  };
  toolCall?: TrajectoryToolCall;
  reasoning?: {
    content: string;
    complete: boolean;
  };
};

export type TrajectoryTurn = {
  turnIndex: number;
  runId: string | null;
  status: "in_progress" | "completed" | "failed";
  startSequence: number;
  endSequence?: number;
  startedAt: Date;
  completedAt?: Date;
  trigger: {
    type: "user_message" | "candidate_answer" | "candidate_skip" | "opening_trigger" | "system";
    content?: string;
    sequence: number;
  };
  items: TrajectoryItem[];
  steps: TrajectoryStep[];
  domainOutcome?: {
    type: "question_committed" | "completion_requested" | "answer_analyzed" | "assistant_message";
    summary: string;
    payload: unknown;
  };
  totalMetrics: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
    toolCallCount: number;
  };
};

