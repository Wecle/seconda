import { z } from "zod";
import { AgentToolRegistry, type AgentToolContext } from "@/lib/agent/tool-registry";
import { submitInterviewActionSchema } from "./action";

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
      const { commitInterviewAgentAction } = await import("../application/commit-agent-action");
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
