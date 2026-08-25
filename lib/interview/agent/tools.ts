import { z } from "zod";
import { AgentToolRegistry, type AgentToolContext } from "@/lib/agent/tool-registry";
import { submitInterviewActionSchema } from "./action";
import { CURRENT_AGENT_STEP } from "@/lib/agent/capabilities/types";
import { SKILL_LOAD_FAILED, SKILL_LOADED_STEP, SKILL_LOADING_STEP } from "@/lib/agent/skills/tool";

export const INTERVIEW_ACTION_COMMITTED = Symbol("interview-action-committed");
export const INTERVIEW_DOMAIN_ACTION_BLOCKED = Symbol("interview-domain-action-blocked");
export const INTERVIEW_SKILL_RETRY_STEP = Symbol("interview-skill-retry-step");
export const INTERVIEW_FATAL_ACTION_ERROR = Symbol("interview-fatal-action-error");

export function isFatalInterviewActionError(error: unknown) {
  if (!(error instanceof Error)) return true;
  return [
    "Interview ownership mismatch",
    "Interview run identity mismatch",
    "Interview run is not authorized to commit",
    "Opening run is not authorized to commit",
    "Interview turn is not authorized to commit",
    "Completed interview action replay does not match",
    "Interview resume snapshot is missing",
    "Interview already has a question awaiting an answer",
  ].some((message) => error.message.startsWith(message));
}

export const interviewCapabilityConfigSchema = z.object({
  interviewId: z.string().uuid(),
  interviewRunId: z.string().uuid(),
  triggerType: z.enum(["opening", "answer", "skip"]),
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

const outputSchema = z.discriminatedUnion("action", [
  z.object({
    status: z.literal("committed"),
    action: z.literal("ask_question"),
    questionId: z.string().uuid(),
  }).strict(),
  z.object({
    status: z.literal("committed"),
    action: z.literal("complete_interview"),
  }).strict(),
]);

function hasSameStepSkillActivity(context: InterviewToolContext) {
  const currentStep = context.state.get(CURRENT_AGENT_STEP);
  return context.state.get(SKILL_LOADING_STEP) === currentStep
    || context.state.get(SKILL_LOADED_STEP) === currentStep;
}

export function createInterviewToolRegistry() {
  const registry = new AgentToolRegistry<InterviewToolContext>();
  registry.register({
    name: "submit_interview_action",
    description: "提交当前面试 Run 的唯一领域动作。只有工具成功返回 committed，问题才会成为业务事实。",
    inputSchema: submitInterviewActionSchema,
    outputSchema,
    async execute(action, context) {
      const proposal = submitInterviewActionSchema.parse(action);
      const currentStep = context.state.get(CURRENT_AGENT_STEP);
      if (typeof currentStep === "number"
        && (currentStep <= context.skillLoadStep || context.state.has(INTERVIEW_DOMAIN_ACTION_BLOCKED))) {
        context.state.set(INTERVIEW_SKILL_RETRY_STEP, currentStep + 1);
        throw new Error("Interview actions require a separate model step after Skill discovery");
      }
      if (context.state.has(SKILL_LOAD_FAILED)) {
        throw new Error("Interview action is blocked after a Skill load failure");
      }
      if (hasSameStepSkillActivity(context)) {
        throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
      }
      await Promise.resolve();
      if (hasSameStepSkillActivity(context)) {
        throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
      }
      const { commitInterviewAgentAction } = await import("../application/commit-agent-action");
      if (context.state.has(SKILL_LOAD_FAILED)) {
        throw new Error("Interview action is blocked after a Skill load failure");
      }
      if (hasSameStepSkillActivity(context)) {
        throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
      }
      let question: Awaited<ReturnType<typeof commitInterviewAgentAction>>;
      try {
        question = await commitInterviewAgentAction({
          userId: context.userId,
          sessionId: context.sessionId,
          agentRunId: context.agentRunId,
          interviewId: context.config.interviewId,
          interviewRunId: context.config.interviewRunId,
          attemptGeneration: context.config.attemptGeneration,
          action: proposal,
        });
      } catch (error) {
        if (isFatalInterviewActionError(error)) context.state.set(INTERVIEW_FATAL_ACTION_ERROR, true);
        throw error;
      }
      context.state.set(INTERVIEW_ACTION_COMMITTED, true);
      return proposal.action.type === "complete_interview"
        ? { status: "committed", action: "complete_interview" }
        : { status: "committed", action: "ask_question", questionId: question.id };
    },
  });
  return registry;
}
