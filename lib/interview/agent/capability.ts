import { BUILT_IN_CAPABILITIES, type AgentCapability } from "@/lib/agent/capabilities/types";
import { INTERVIEW_AGENT_PROMPT_VERSION } from "./prompt";
import { createInterviewContextProviders } from "./context";
import {
  createInterviewToolRegistry,
  INTERVIEW_ACTION_COMMITTED,
  interviewCapabilityConfigSchema,
} from "./tools";

export const interviewCapability: AgentCapability = {
  id: BUILT_IN_CAPABILITIES.interview,
  promptVersion: INTERVIEW_AGENT_PROMPT_VERSION,
  maxSteps: 3,
  createContextProviders(context) {
    interviewCapabilityConfigSchema.parse(context.capabilityConfig);
    return createInterviewContextProviders(context.systemPrompt);
  },
  createToolRegistry(context) {
    const registry = createInterviewToolRegistry();
    const toolContext = {
      userId: context.userId,
      sessionId: context.sessionId,
      agentRunId: context.runId,
      config: interviewCapabilityConfigSchema.parse(context.capabilityConfig),
      state: context.state,
      signal: context.signal,
    };
    return {
      schemas: registry.schemas.bind(registry),
      toAISDKTools: () => registry.toAISDKTools(toolContext),
      toolOrder: ["submit_interview_action"],
    };
  },
  afterStep(context) {
    return context.state.get(INTERVIEW_ACTION_COMMITTED)
      ? { action: "stop", reason: "interview-action-committed" }
      : { action: "continue" };
  },
};
