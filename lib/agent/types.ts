import type { ModelMessage } from "ai";

export const AGENT_EVENT_TYPES = [
  "run_started",
  "step_started",
  "assistant_chunk",
  "assistant_delta",
  "tool_called",
  "tool_completed",
  "step_completed",
  "model_message",
  "run_completed",
  "run_failed",
  "run_cancelled",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentEvent = {
  id: number;
  sessionId: string;
  runId: string | null;
  sequence: number;
  type: AgentEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
};

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
};

export type AgentRunInput = {
  sessionId: string;
  runId: string;
  model: string;
  systemPrompt: string;
  messages: ModelMessage[];
  workspaceRoot: string;
  maxSteps: number;
  signal: AbortSignal;
  events: AgentEventSink;
};
