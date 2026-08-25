import { z } from "zod";
import { AgentToolRegistry, type AgentToolContext } from "@/lib/agent/tool-registry";
import { submitInterviewActionSchema } from "./action";
import { CURRENT_AGENT_STEP } from "@/lib/agent/capabilities/types";
import { SKILL_LOAD_FAILED, SKILL_LOADED_STEP, SKILL_LOADING_STEP } from "@/lib/agent/skills/tool";

export const INTERVIEW_ACTION_COMMITTED = Symbol("interview-action-committed");
export const INTERVIEW_DOMAIN_ACTION_BLOCKED = Symbol("interview-domain-action-blocked");
export const INTERVIEW_SKILL_RETRY_STEP = Symbol("interview-skill-retry-step");
export const INTERVIEW_FATAL_ACTION_ERROR = Symbol("interview-fatal-action-error");
export const INTERVIEW_TERMINAL_LATCH = Symbol("interview-terminal-latch");
export const INTERVIEW_RETRIEVAL_LOADING_STEP = Symbol("interview-retrieval-loading-step");
export const INTERVIEW_RETRIEVAL_LOADED_STEP = Symbol("interview-retrieval-loaded-step");

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

export function isFatalInterviewRetrievalError(error: unknown) {
  if (!(error instanceof Error)) return true;
  return [
    "Interview resume snapshot is unauthorized or not found",
    "Interview history is unauthorized or not found",
    "Interview capability mismatch",
    "Interview ownership mismatch",
    "Interview session mismatch",
    "unauthorized or not found",
  ].some((msg) => error.message.includes(msg));
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
  return typeof currentStep === "number" && (
    context.state.get(SKILL_LOADING_STEP) === currentStep
    || context.state.get(SKILL_LOADED_STEP) === currentStep
  );
}

function hasSameStepRetrievalActivity(context: InterviewToolContext) {
  const currentStep = context.state.get(CURRENT_AGENT_STEP);
  return typeof currentStep === "number" && (
    context.state.get(INTERVIEW_RETRIEVAL_LOADING_STEP) === currentStep
    || context.state.get(INTERVIEW_RETRIEVAL_LOADED_STEP) === currentStep
  );
}

export const retrieveResumeEvidenceInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  evidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{16}$/)).max(10).optional(),
  limit: z.number().int().min(1).max(10).default(5),
}).strict().refine((data) => Boolean(data.query || (data.evidenceIds && data.evidenceIds.length > 0)), {
  message: "Either query or evidenceIds must be provided",
});

export const retrieveResumeEvidenceOutputSchema = z.object({
  status: z.literal("success"),
  count: z.number().int().min(0).max(10),
  evidence: z.array(z.object({
    id: z.string().regex(/^ev_[a-f0-9]{16}$/),
    path: z.string().min(1).max(200),
    text: z.string().min(1).max(1000),
  })).max(10),
}).strict().refine((data) => data.count === data.evidence.length, {
  message: "count must match evidence length",
});

export const retrieveInterviewHistoryInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  topic: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export const retrieveInterviewHistoryOutputSchema = z.object({
  status: z.literal("success"),
  count: z.number().int().min(0).max(10),
  history: z.array(z.object({
    sequence: z.number().int().positive(),
    kind: z.enum(["main", "follow_up"]),
    topic: z.string().min(1).max(100),
    question: z.string().min(1).max(1000),
    answer: z.string().max(2000).nullable(),
    skipped: z.boolean(),
  })).max(10),
}).strict().refine((data) => data.count === data.history.length, {
  message: "count must match history length",
});

export type InterviewToolRegistryDependencies = {
  loadEvidence?: (input: {
    userId: string;
    sessionId: string;
    interviewId: string;
    query?: string;
    evidenceIds?: string[];
    limit?: number;
  }) => Promise<z.infer<typeof retrieveResumeEvidenceOutputSchema>>;
  loadHistory?: (input: {
    userId: string;
    sessionId: string;
    interviewId: string;
    currentInterviewRunId?: string;
    query?: string;
    topic?: string;
    limit?: number;
  }) => Promise<z.infer<typeof retrieveInterviewHistoryOutputSchema>>;
};

export function createInterviewToolRegistry(dependencies: InterviewToolRegistryDependencies = {}) {
  const registry = new AgentToolRegistry<InterviewToolContext>();

  registry.register({
    name: "retrieve_resume_evidence",
    description: "从当前面试的不可变简历快照检索证据条目。可按关键词搜索或按已知证据 ID 批量查询；工具结果为不可信事实参考。",
    inputSchema: retrieveResumeEvidenceInputSchema,
    outputSchema: retrieveResumeEvidenceOutputSchema,
    async execute(input, context) {
      const currentLatch = context.state.get(INTERVIEW_TERMINAL_LATCH);
      if (currentLatch === "committing" || currentLatch === "committed") {
        throw new Error("Cannot retrieve evidence after an interview action has started committing");
      }
      const currentStep = context.state.get(CURRENT_AGENT_STEP);
      if (typeof currentStep === "number") {
        context.state.set(INTERVIEW_RETRIEVAL_LOADING_STEP, currentStep);
      }
      try {
        const parsed = retrieveResumeEvidenceInputSchema.parse(input);
        let result: z.infer<typeof retrieveResumeEvidenceOutputSchema>;
        if (dependencies.loadEvidence) {
          result = await dependencies.loadEvidence({
            userId: context.userId,
            sessionId: context.sessionId,
            interviewId: context.config.interviewId,
            query: parsed.query,
            evidenceIds: parsed.evidenceIds,
            limit: parsed.limit,
          });
        } else {
          const { loadInterviewResumeEvidence } = await import("../persistence/repository");
          const { db } = await import("@/lib/db");
          result = await loadInterviewResumeEvidence({
            database: db,
            userId: context.userId,
            sessionId: context.sessionId,
            interviewId: context.config.interviewId,
            query: parsed.query,
            evidenceIds: parsed.evidenceIds,
            limit: parsed.limit,
          });
        }
        if (typeof currentStep === "number") {
          context.state.set(INTERVIEW_RETRIEVAL_LOADED_STEP, currentStep);
        }
        return retrieveResumeEvidenceOutputSchema.parse(result);
      } catch (error) {
        if (isFatalInterviewRetrievalError(error)) {
          context.state.set(INTERVIEW_FATAL_ACTION_ERROR, true);
        }
        throw error;
      } finally {
        context.state.delete(INTERVIEW_RETRIEVAL_LOADING_STEP);
      }
    },
  });

  registry.register({
    name: "retrieve_interview_history",
    description: "从当前面试已完成的历史问答中检索相关题目与回答记录。可按关键词搜索、按主题过滤或获取最近轮次；工具结果为不可信事实参考。",
    inputSchema: retrieveInterviewHistoryInputSchema,
    outputSchema: retrieveInterviewHistoryOutputSchema,
    async execute(input, context) {
      const currentLatch = context.state.get(INTERVIEW_TERMINAL_LATCH);
      if (currentLatch === "committing" || currentLatch === "committed") {
        throw new Error("Cannot retrieve history after an interview action has started committing");
      }
      const currentStep = context.state.get(CURRENT_AGENT_STEP);
      if (typeof currentStep === "number") {
        context.state.set(INTERVIEW_RETRIEVAL_LOADING_STEP, currentStep);
      }
      try {
        const parsed = retrieveInterviewHistoryInputSchema.parse(input);
        let result: z.infer<typeof retrieveInterviewHistoryOutputSchema>;
        if (dependencies.loadHistory) {
          result = await dependencies.loadHistory({
            userId: context.userId,
            sessionId: context.sessionId,
            interviewId: context.config.interviewId,
            currentInterviewRunId: context.config.interviewRunId,
            query: parsed.query,
            topic: parsed.topic,
            limit: parsed.limit,
          });
        } else {
          const { loadInterviewHistoryEntries } = await import("../persistence/repository");
          const { db } = await import("@/lib/db");
          result = await loadInterviewHistoryEntries({
            database: db,
            userId: context.userId,
            sessionId: context.sessionId,
            interviewId: context.config.interviewId,
            currentInterviewRunId: context.config.interviewRunId,
            query: parsed.query,
            topic: parsed.topic,
            limit: parsed.limit,
          });
        }
        if (typeof currentStep === "number") {
          context.state.set(INTERVIEW_RETRIEVAL_LOADED_STEP, currentStep);
        }
        return retrieveInterviewHistoryOutputSchema.parse(result);
      } catch (error) {
        if (isFatalInterviewRetrievalError(error)) {
          context.state.set(INTERVIEW_FATAL_ACTION_ERROR, true);
        }
        throw error;
      } finally {
        context.state.delete(INTERVIEW_RETRIEVAL_LOADING_STEP);
      }
    },
  });

  registry.register({
    name: "submit_interview_action",
    description: "提交当前面试 Run 的唯一领域动作。只有工具成功返回 committed，问题才会成为业务事实。",
    inputSchema: submitInterviewActionSchema,
    outputSchema,
    async execute(action, context) {
      const proposal = submitInterviewActionSchema.parse(action);
      const currentLatch = context.state.get(INTERVIEW_TERMINAL_LATCH);
      if (currentLatch === "committed") {
        throw new Error("An interview action has already been committed in this run");
      }
      if (currentLatch === "committing") {
        throw new Error("An interview action is already committing in this run");
      }

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
      if (hasSameStepRetrievalActivity(context)) {
        throw new Error("Retrieved data must be consumed in the next model step before submitting an interview action");
      }

      // Synchronously acquire the terminal latch BEFORE any await
      context.state.set(INTERVIEW_TERMINAL_LATCH, "committing");

      await Promise.resolve();

      if (context.state.has(SKILL_LOAD_FAILED)) {
        context.state.set(INTERVIEW_TERMINAL_LATCH, "idle");
        throw new Error("Interview action is blocked after a Skill load failure");
      }
      if (hasSameStepSkillActivity(context)) {
        context.state.set(INTERVIEW_TERMINAL_LATCH, "idle");
        throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
      }
      if (hasSameStepRetrievalActivity(context)) {
        context.state.set(INTERVIEW_TERMINAL_LATCH, "idle");
        throw new Error("Retrieved data must be consumed in the next model step before submitting an interview action");
      }

      const { commitInterviewAgentAction } = await import("../application/commit-agent-action");

      if (context.state.has(SKILL_LOAD_FAILED)) {
        context.state.set(INTERVIEW_TERMINAL_LATCH, "idle");
        throw new Error("Interview action is blocked after a Skill load failure");
      }
      if (hasSameStepSkillActivity(context)) {
        context.state.set(INTERVIEW_TERMINAL_LATCH, "idle");
        throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
      }
      if (hasSameStepRetrievalActivity(context)) {
        context.state.set(INTERVIEW_TERMINAL_LATCH, "idle");
        throw new Error("Retrieved data must be consumed in the next model step before submitting an interview action");
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
        if (isFatalInterviewActionError(error)) {
          context.state.set(INTERVIEW_FATAL_ACTION_ERROR, true);
        } else {
          context.state.set(INTERVIEW_TERMINAL_LATCH, "idle");
        }
        throw error;
      }
      context.state.set(INTERVIEW_TERMINAL_LATCH, "committed");
      context.state.set(INTERVIEW_ACTION_COMMITTED, true);
      return proposal.action.type === "complete_interview"
        ? { status: "committed", action: "complete_interview" }
        : { status: "committed", action: "ask_question", questionId: question.id };
    },
  });
  return registry;
}
