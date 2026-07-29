export {
  agentModelStepSchema,
  agentProviderStepSchema,
  type AgentModelStep,
} from "@/lib/interview/agent/protocols/events";

import type { AgentModelStep } from "@/lib/interview/agent/protocols/events";

export type AgentRuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type AgentToolDescriptor = {
  name: string;
  description: string;
};

export type AgentModelStreamEvent =
  | {
    type: "public_reasoning_delta";
    attemptId: string;
    text: string;
  }
  | {
    type: "tool_input_delta";
    attemptId: string;
    toolCallId: string;
    toolName: string;
    inputText: string;
    partialInput: unknown;
  };

export type AgentNextStepInput = {
  runId: string;
  attemptNumberOffset?: number;
  messages: readonly AgentRuntimeMessage[];
  tools: readonly AgentToolDescriptor[];
  signal: AbortSignal;
  promptContext?: {
    stablePrefix: string;
    incrementalTail: string;
  };
};

export interface InterviewAgentModelPort {
  nextStep(input: AgentNextStepInput): Promise<AgentModelStep>;
  nextStepStream?(input: AgentNextStepInput & {
    onAttemptStarted?: (attempt: {
      model: string;
      attemptId: string;
      attemptNumber: number;
      provisionalMessageId: string;
    }) => Promise<void>;
    onProviderProgress: () => Promise<void>;
    onStreamEvent: (event: AgentModelStreamEvent) => Promise<boolean>;
  }): Promise<{
    step: AgentModelStep;
    attemptId: string;
    provisionalMessageId: string | null;
  }>;
}
