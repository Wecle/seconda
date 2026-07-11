import { generateStructured } from "@/lib/ai/generate-structured";
import { agentModelStepSchema, type AgentModelStep } from "./contracts";

export type AgentRuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type AgentToolDescriptor = {
  name: string;
  description: string;
};

export interface InterviewAgentModelPort {
  nextStep(input: {
    runId: string;
    messages: readonly AgentRuntimeMessage[];
    tools: readonly AgentToolDescriptor[];
    signal: AbortSignal;
  }): Promise<AgentModelStep>;
}

export function createStructuredInterviewAgentModelPort(): InterviewAgentModelPort {
  return {
    nextStep(input) {
      return generateStructured({
        task: "interview.agent",
        schema: agentModelStepSchema,
        abortSignal: input.signal,
        system:
          "你是 Seconda 面试 Agent。只能返回一个符合 Schema 的工具调用或最终内部状态。候选人可见内容必须通过 ask_interview_question 或 finish_interview 工具提交。不得虚构简历经历，不得绕过题型和轮次限制。",
        prompt: JSON.stringify({
          runId: input.runId,
          tools: input.tools,
          messages: input.messages,
        }),
      });
    },
  };
}
