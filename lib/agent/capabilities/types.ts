import type { ToolSet } from "ai";
import type { AgentEvent, AgentEventSink, ContextProvider } from "../types";
import type { AgentToolRegistry } from "../tool-registry";

export type AgentCapabilityId = string & {};

export const BUILT_IN_CAPABILITIES = {
  workspace: "workspace",
  interview: "interview",
} as const;

export type CapabilityContext = {
  sessionId: string;
  runId: string;
  userId: string;
  model: string;
  systemPrompt: string;
  promptVersion: string;
  capabilityConfig: unknown;
  signal: AbortSignal;
  events: AgentEventSink;
};

export type StepDecision =
  | { action: "continue" }
  | { action: "stop"; reason: string };

export type CapabilityStepContext = CapabilityContext & {
  step: number;
};

export type CapabilityStepResult = CapabilityStepContext & {
  content: readonly { type: string }[];
};

export type CapabilityProjectionContribution = Record<string, unknown>;

export type CapabilityToolRegistry = {
  schemas: AgentToolRegistry["schemas"];
  toAISDKTools(): ToolSet;
  toolOrder?: string[];
};

export interface AgentCapability {
  readonly id: AgentCapabilityId;
  readonly promptVersion: string;
  readonly maxSteps: number;

  createContextProviders(context: CapabilityContext): ContextProvider[];
  createToolRegistry(context: CapabilityContext): CapabilityToolRegistry;
  beforeStep?(context: CapabilityStepContext): Promise<StepDecision> | StepDecision;
  afterStep?(context: CapabilityStepResult): Promise<StepDecision> | StepDecision;
  projectEvent?(event: AgentEvent): CapabilityProjectionContribution | null;
}
