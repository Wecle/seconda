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
