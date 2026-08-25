import { BUILT_IN_CAPABILITIES, type AgentCapability } from "@/lib/agent/capabilities/types";
import { INTERVIEW_AGENT_PROMPT_VERSION } from "./prompt";
import { createInterviewContextProviders } from "./context";
import {
  createInterviewToolRegistry,
  INTERVIEW_ACTION_COMMITTED,
  interviewCapabilityConfigSchema,
} from "./tools";
import { INTERVIEW_SKILL_NAMES } from "./skills/built-ins";
import { SKILL_LOAD_FAILED } from "@/lib/agent/skills/tool";

export const interviewCapability: AgentCapability = {
  id: BUILT_IN_CAPABILITIES.interview,
  promptVersion: INTERVIEW_AGENT_PROMPT_VERSION,
  maxSteps: 3,
  skillAllowlist: INTERVIEW_SKILL_NAMES,
  skillLoadStep: 1,
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
      skillLoadStep: 1,
      signal: context.signal,
    };
    return {
      schemas: registry.schemas.bind(registry),
      toAISDKTools: () => registry.toAISDKTools(toolContext),
      toolOrder: ["submit_interview_action"],
    };
  },
  afterStep(context) {
    if (context.state.has(SKILL_LOAD_FAILED)) {
      return { action: "stop", reason: "interview-skill-load-failed" };
    }
    return context.state.get(INTERVIEW_ACTION_COMMITTED)
      ? { action: "stop", reason: "interview-action-committed" }
      : { action: "continue" };
  },
};
