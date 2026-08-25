import { z } from "zod";
import { AgentToolRegistry, type AgentToolContext } from "@/lib/agent/tool-registry";
import { submitInterviewActionSchema } from "./action";
import { CURRENT_AGENT_STEP } from "@/lib/agent/capabilities/types";
import { SKILL_LOAD_FAILED, SKILL_LOADED_STEP } from "@/lib/agent/skills/tool";

export const INTERVIEW_ACTION_COMMITTED = Symbol("interview-action-committed");

export const interviewCapabilityConfigSchema = z.object({
  interviewId: z.string().uuid(),
  interviewRunId: z.string().uuid(),
  triggerType: z.literal("opening"),
  attemptGeneration: z.number().int().positive(),
}).strict();

export type InterviewToolContext = AgentToolContext & {
  userId: string;
  sessionId: string;
  agentRunId: string;
  state: Map<PropertyKey, unknown>;
  skillLoadStep: number;
  config: z.infer<typeof interviewCapabilityConfigSchema>;
};

const outputSchema = z.object({
  status: z.literal("committed"),
  action: z.literal("ask_question"),
  questionId: z.string().uuid(),
}).strict();

export function createInterviewToolRegistry() {
  const registry = new AgentToolRegistry<InterviewToolContext>();
  registry.register({
    name: "submit_interview_action",
    description: "提交当前面试 Run 的唯一领域动作。只有工具成功返回 committed，问题才会成为业务事实。",
    inputSchema: submitInterviewActionSchema,
    outputSchema,
    async execute(action, context) {
      const currentStep = context.state.get(CURRENT_AGENT_STEP);
      if (typeof currentStep === "number" && currentStep <= context.skillLoadStep) {
        throw new Error("Interview actions require a separate model step after Skill discovery");
      }
      if (context.state.has(SKILL_LOAD_FAILED)) {
        throw new Error("Interview action is blocked after a Skill load failure");
      }
      if (context.state.get(SKILL_LOADED_STEP) === context.state.get(CURRENT_AGENT_STEP)) {
        throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
      }
      const { commitInterviewAgentAction } = await import("../application/commit-agent-action");
      if (context.state.has(SKILL_LOAD_FAILED)) {
        throw new Error("Interview action is blocked after a Skill load failure");
      }
      const question = await commitInterviewAgentAction({
        userId: context.userId,
        sessionId: context.sessionId,
        agentRunId: context.agentRunId,
        interviewId: context.config.interviewId,
        interviewRunId: context.config.interviewRunId,
        attemptGeneration: context.config.attemptGeneration,
        action,
      });
      context.state.set(INTERVIEW_ACTION_COMMITTED, true);
      return { status: "committed", action: "ask_question", questionId: question.id };
    },
  });
  return registry;
}
