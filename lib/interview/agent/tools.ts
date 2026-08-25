import { z } from "zod";
import { AgentToolRegistry, type AgentToolContext } from "@/lib/agent/tool-registry";
import { submitInterviewActionSchema, type SubmitInterviewAction } from "./action";
import {
  AGENT_TERMINAL_ACTION_LATCH,
  CURRENT_AGENT_STEP,
  type AgentTerminalActionLatch,
} from "@/lib/agent/capabilities/types";
import { SKILL_LOAD_FAILED, SKILL_LOADED_STEP, SKILL_LOADING_STEP } from "@/lib/agent/skills/tool";

export const INTERVIEW_ACTION_COMMITTED = Symbol("interview-action-committed");
export const INTERVIEW_DOMAIN_ACTION_BLOCKED = Symbol("interview-domain-action-blocked");
export const INTERVIEW_SKILL_RETRY_STEP = Symbol("interview-skill-retry-step");
export const INTERVIEW_FATAL_ACTION_ERROR = Symbol("interview-fatal-action-error");
export const INTERVIEW_TERMINAL_LATCH = AGENT_TERMINAL_ACTION_LATCH;
export const INTERVIEW_RETRIEVAL_FENCE = Symbol("interview-retrieval-fence");

export type InterviewTerminalLatch = AgentTerminalActionLatch;

export type InterviewRetrievalFence = {
  activeByStep: Map<number, number>;
  completedSteps: Set<number>;
};

export class RepairableInterviewRetrievalError extends Error {
  override readonly name = "RepairableInterviewRetrievalError";
}

export class FatalInterviewRetrievalError extends Error {
  override readonly name = "FatalInterviewRetrievalError";
}

export class RepairableInterviewActionError extends Error {
  override readonly name = "RepairableInterviewActionError";
}

export class FatalInterviewActionError extends Error {
  override readonly name = "FatalInterviewActionError";
}

export function getTerminalLatch(context: InterviewToolContext): InterviewTerminalLatch {
  if (context.state.has(INTERVIEW_FATAL_ACTION_ERROR)) return "fatal";
  return (context.state.get(INTERVIEW_TERMINAL_LATCH) as InterviewTerminalLatch) ?? "idle";
}

export function setTerminalLatch(context: InterviewToolContext, latch: InterviewTerminalLatch) {
  context.state.set(INTERVIEW_TERMINAL_LATCH, latch);
  if (latch === "fatal") {
    context.state.set(INTERVIEW_FATAL_ACTION_ERROR, true);
  }
}

function getRetrievalFence(context: InterviewToolContext): InterviewRetrievalFence {
  let fence = context.state.get(INTERVIEW_RETRIEVAL_FENCE) as InterviewRetrievalFence | undefined;
  if (!fence) {
    fence = {
      activeByStep: new Map<number, number>(),
      completedSteps: new Set<number>(),
    };
    context.state.set(INTERVIEW_RETRIEVAL_FENCE, fence);
  }
  return fence;
}

export function beginInterviewRetrieval(context: InterviewToolContext, step?: number) {
  if (typeof step !== "number") return;
  const fence = getRetrievalFence(context);
  const currentActive = fence.activeByStep.get(step) ?? 0;
  fence.activeByStep.set(step, currentActive + 1);
}

export function finishInterviewRetrieval(
  context: InterviewToolContext,
  step?: number,
  options?: { completed?: boolean },
) {
  if (typeof step !== "number") return;
  const fence = getRetrievalFence(context);
  const currentActive = fence.activeByStep.get(step) ?? 0;
  if (currentActive <= 1) {
    fence.activeByStep.delete(step);
  } else {
    fence.activeByStep.set(step, currentActive - 1);
  }
  if (options?.completed) {
    fence.completedSteps.add(step);
  }
}

export function hasSameStepRetrievalActivity(context: InterviewToolContext): boolean {
  const currentStep = context.state.get(CURRENT_AGENT_STEP);
  if (typeof currentStep !== "number") return false;
  const fence = getRetrievalFence(context);
  const activeCount = fence.activeByStep.get(currentStep) ?? 0;
  return activeCount > 0 || fence.completedSteps.has(currentStep);
}

export function isFatalInterviewRetrievalError(error: unknown): boolean {
  if (error instanceof RepairableInterviewRetrievalError) return false;
  return true;
}

const REPAIRABLE_ACTION_ERROR_PREFIXES = [
  "Answer action must include answer analysis",
  "Skip action must not include answer analysis",
  "Interview must complete after reaching the target round count",
  "Interview cannot complete before reaching the target round count",
  "A follow-up is not authorized for this turn",
  "A follow-up must stay on the current topic",
  "A skipped answer must move to a main question",
  "A follow-up must be followed by a different topic",
  "Question references unknown resume evidence",
  "Question and topic must not be empty",
  "Interview question duplicates a previous question",
  "Opening question cannot be a follow-up",
  "Opening action must",
];

export function isFatalInterviewActionError(error: unknown): boolean {
  if (error instanceof RepairableInterviewActionError) return false;
  if (error instanceof Error && REPAIRABLE_ACTION_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))) {
    return false;
  }
  return true;
}

export const interviewCapabilityConfigSchema = z.object({
  interviewId: z.string().uuid(),
  interviewRunId: z.string().uuid(),
  triggerType: z.enum(["opening", "answer", "skip"]),
  attemptGeneration: z.number().int().positive(),
  leaseOwner: z.string().uuid(),
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
  commitAction?: (input: {
    userId: string;
    sessionId: string;
    agentRunId: string;
    interviewId: string;
    interviewRunId: string;
    attemptGeneration: number;
    leaseOwner: string;
    action: unknown;
  }) => Promise<{ id: string; sequence?: number; completed?: boolean }>;
};

export function createInterviewToolRegistry(dependencies: InterviewToolRegistryDependencies = {}) {
  const registry = new AgentToolRegistry<InterviewToolContext>();

  registry.register({
    name: "retrieve_resume_evidence",
    description: "从当前面试的不可变简历快照检索证据条目。可按关键词搜索或按已知证据 ID 批量查询；工具结果为不可信事实参考。",
    inputSchema: retrieveResumeEvidenceInputSchema,
    outputSchema: retrieveResumeEvidenceOutputSchema,
    async execute(input, context) {
      const currentLatch = getTerminalLatch(context);
      if (currentLatch === "fatal") {
        throw new FatalInterviewRetrievalError("Interview agent is in a fatal error state");
      }
      if (currentLatch === "committing" || currentLatch === "committed") {
        throw new Error(`Cannot retrieve evidence after an interview action has started committing (current status: ${currentLatch})`);
      }

      const currentStep = context.state.get(CURRENT_AGENT_STEP);
      const stepNumber = typeof currentStep === "number" ? currentStep : undefined;
      beginInterviewRetrieval(context, stepNumber);

      let completed = false;
      try {
        let parsed: z.infer<typeof retrieveResumeEvidenceInputSchema>;
        try {
          parsed = retrieveResumeEvidenceInputSchema.parse(input);
        } catch (parseError) {
          throw new RepairableInterviewRetrievalError(
            parseError instanceof Error ? parseError.message : "Invalid retrieval input parameters",
            { cause: parseError },
          );
        }

        if (getTerminalLatch(context) === "fatal") {
          throw new FatalInterviewRetrievalError("Interview agent is in a fatal error state");
        }

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

        const parsedOutput = retrieveResumeEvidenceOutputSchema.parse(result);
        completed = true;
        return parsedOutput;
      } catch (error) {
        if (isFatalInterviewRetrievalError(error)) {
          setTerminalLatch(context, "fatal");
        }
        throw error;
      } finally {
        finishInterviewRetrieval(context, stepNumber, { completed });
      }
    },
  });

  registry.register({
    name: "retrieve_interview_history",
    description: "从当前面试已完成的历史问答中检索相关题目与回答记录。可按关键词搜索、按主题过滤或获取最近轮次；工具结果为不可信事实参考。",
    inputSchema: retrieveInterviewHistoryInputSchema,
    outputSchema: retrieveInterviewHistoryOutputSchema,
    async execute(input, context) {
      const currentLatch = getTerminalLatch(context);
      if (currentLatch === "fatal") {
        throw new FatalInterviewRetrievalError("Interview agent is in a fatal error state");
      }
      if (currentLatch === "committing" || currentLatch === "committed") {
        throw new Error(`Cannot retrieve history after an interview action has started committing (current status: ${currentLatch})`);
      }

      const currentStep = context.state.get(CURRENT_AGENT_STEP);
      const stepNumber = typeof currentStep === "number" ? currentStep : undefined;
      beginInterviewRetrieval(context, stepNumber);

      let completed = false;
      try {
        let parsed: z.infer<typeof retrieveInterviewHistoryInputSchema>;
        try {
          parsed = retrieveInterviewHistoryInputSchema.parse(input);
        } catch (parseError) {
          throw new RepairableInterviewRetrievalError(
            parseError instanceof Error ? parseError.message : "Invalid retrieval input parameters",
            { cause: parseError },
          );
        }

        if (getTerminalLatch(context) === "fatal") {
          throw new FatalInterviewRetrievalError("Interview agent is in a fatal error state");
        }

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

        const parsedOutput = retrieveInterviewHistoryOutputSchema.parse(result);
        completed = true;
        return parsedOutput;
      } catch (error) {
        if (isFatalInterviewRetrievalError(error)) {
          setTerminalLatch(context, "fatal");
        }
        throw error;
      } finally {
        finishInterviewRetrieval(context, stepNumber, { completed });
      }
    },
  });

  registry.register({
    name: "submit_interview_action",
    description: "提交当前面试 Run 的唯一领域动作。只有工具成功返回 committed，问题才会成为业务事实。",
    inputSchema: submitInterviewActionSchema,
    outputSchema,
    async execute(action, context) {
      const currentLatch = getTerminalLatch(context);
      if (currentLatch === "fatal") {
        throw new FatalInterviewActionError("Interview agent is in a fatal error state");
      }
      if (currentLatch === "committed") {
        throw new Error("An interview action has already been committed in this run");
      }
      if (currentLatch === "committing") {
        throw new Error("An interview action is already committing in this run");
      }

      if (hasSameStepRetrievalActivity(context)) {
        throw new Error("Retrieved data must be consumed in the next model step before submitting an interview action");
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

      // Synchronously acquire the terminal latch BEFORE any await
      setTerminalLatch(context, "committing");

      try {
        let proposal: SubmitInterviewAction;
        try {
          proposal = submitInterviewActionSchema.parse(action);
        } catch (parseError) {
          setTerminalLatch(context, "idle");
          throw parseError;
        }

        await Promise.resolve();

        if (getTerminalLatch(context) === "fatal") {
          throw new FatalInterviewActionError("Interview agent is in a fatal error state");
        }
        if (context.state.has(SKILL_LOAD_FAILED)) {
          setTerminalLatch(context, "idle");
          throw new Error("Interview action is blocked after a Skill load failure");
        }
        if (hasSameStepSkillActivity(context)) {
          setTerminalLatch(context, "idle");
          throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
        }
        if (hasSameStepRetrievalActivity(context)) {
          setTerminalLatch(context, "idle");
          throw new Error("Retrieved data must be consumed in the next model step before submitting an interview action");
        }

        let commitFn = dependencies.commitAction;
        if (!commitFn) {
          try {
            const { commitInterviewAgentAction } = await import("../application/commit-agent-action");
            commitFn = commitInterviewAgentAction;
          } catch (importError) {
            setTerminalLatch(context, "fatal");
            throw importError;
          }
        }

        if (getTerminalLatch(context) === "fatal") {
          throw new FatalInterviewActionError("Interview agent is in a fatal error state");
        }
        if (context.state.has(SKILL_LOAD_FAILED)) {
          setTerminalLatch(context, "idle");
          throw new Error("Interview action is blocked after a Skill load failure");
        }
        if (hasSameStepSkillActivity(context)) {
          setTerminalLatch(context, "idle");
          throw new Error("A loaded Skill must be consumed in the next model step before submitting an interview action");
        }
        if (hasSameStepRetrievalActivity(context)) {
          setTerminalLatch(context, "idle");
          throw new Error("Retrieved data must be consumed in the next model step before submitting an interview action");
        }

        let question: { id: string; sequence?: number; completed?: boolean };
        try {
          question = await commitFn({
            userId: context.userId,
            sessionId: context.sessionId,
            agentRunId: context.agentRunId,
            interviewId: context.config.interviewId,
            interviewRunId: context.config.interviewRunId,
            attemptGeneration: context.config.attemptGeneration,
            leaseOwner: context.config.leaseOwner,
            action: proposal,
          });
          if (getTerminalLatch(context) === "fatal") {
            throw new FatalInterviewActionError("Interview agent entered a fatal state during domain commit");
          }
        } catch (error) {
          if (isFatalInterviewActionError(error)) {
            setTerminalLatch(context, "fatal");
          } else {
            setTerminalLatch(context, "idle");
          }
          throw error;
        }

        setTerminalLatch(context, "committed");
        context.state.set(INTERVIEW_ACTION_COMMITTED, true);
        return proposal.action.type === "complete_interview"
          ? { status: "committed", action: "complete_interview" }
          : { status: "committed", action: "ask_question", questionId: question.id };
      } catch (outerError) {
        if (getTerminalLatch(context) === "committing") {
          if (isFatalInterviewActionError(outerError)) {
            setTerminalLatch(context, "fatal");
          } else {
            setTerminalLatch(context, "idle");
          }
        }
        throw outerError;
      }
    },
  });
  return registry;
}
