import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import {
  parseModelIdentifier,
  type AIModelTier,
  type AITask,
  type ModelProvider,
} from "@/lib/ai/model-policy";
import { loadAIResourcePolicy, type BudgetMode, type BudgetPolicy } from "./budget";
import { calculateAttemptCost, parseModelPricing } from "./pricing";
import {
  createDrizzleAITelemetryRepository,
  type AITelemetryRepository,
} from "./repository";
import type {
  AITaskTelemetryContext,
  AITaskUsage,
  ModelPriceSnapshot,
  ModelPricingRegistry,
} from "./types";

export type AITaskHandle = {
  id: string | null;
  task: AITask;
  context: AITaskTelemetryContext;
  budgetMode: BudgetMode;
  tokenLimit: number | null;
  noOp: boolean;
};

export type AIAttemptHandle = {
  id: string | null;
  taskRunId: string | null;
  attemptNumber: number;
  provider: ModelProvider;
  model: string;
  credentialTier: AIModelTier;
  startedAtMs: number;
  price: ModelPriceSnapshot | null;
  noOp: boolean;
};

export interface AITelemetryLifecycle {
  startTask(input: { task: AITask; context: AITaskTelemetryContext }): Promise<AITaskHandle>;
  beforeAttempt(input: {
    task: AITaskHandle;
    attemptNumber: number;
    model: string;
    credentialTier: AIModelTier;
  }): Promise<AIAttemptHandle>;
  completeAttempt(input: {
    attempt: AIAttemptHandle;
    usage: AITaskUsage | null;
    firstTokenMs: number | null;
    durationMs: number;
  }): Promise<void>;
  failAttempt(input: {
    attempt: AIAttemptHandle;
    error: unknown;
    usage: AITaskUsage | null;
    firstTokenMs: number | null;
    durationMs: number;
  }): Promise<void>;
  completeTask(task: AITaskHandle): Promise<void>;
  failTask(task: AITaskHandle, error: unknown): Promise<void>;
}

export class AIResourceBudgetError extends Error {
  constructor(public readonly code:
    | "AI_RESOURCE_BUDGET_UNAVAILABLE"
    | "AI_RESOURCE_BUDGET_EXCEEDED") {
    super(code);
    this.name = "AIResourceBudgetError";
  }
}

type LifecycleOptions = {
  repository: AITelemetryRepository;
  policy: BudgetPolicy;
  pricing?: ModelPricingRegistry;
  now?: () => number;
};

function tokenLimitFor(
  context: AITaskTelemetryContext,
  policy: BudgetPolicy,
) {
  return context.budgetScope ? policy.taskTokenLimit : null;
}

function noOpTask(
  task: AITask,
  context: AITaskTelemetryContext,
  mode: BudgetMode,
  tokenLimit: number | null,
): AITaskHandle {
  return { id: null, task, context, budgetMode: mode, tokenLimit, noOp: true };
}

function logFailure(operation: string, task: AITask, error: unknown) {
  console.error("AI telemetry operation failed", {
    operation,
    task,
    category: sanitizeAIError(error).category,
  });
}

export function createAITelemetryLifecycle(options: LifecycleOptions): AITelemetryLifecycle {
  const pricing = options.pricing ?? { version: 1, models: {} };
  const now = options.now ?? Date.now;
  const attemptOwners = new Map<string, {
    task: AITask;
    taskRunId: string;
    budgetMode: BudgetMode;
  }>();
  const unavailableBudgetTasks = new Set<string>();

  return {
    async startTask(input) {
      const tokenLimit = tokenLimitFor(input.context, options.policy);
      try {
        const record = await options.repository.startOrResumeTask({
          ...input,
          budgetMode: options.policy.mode,
          tokenLimit,
        });
        return {
          id: record.id,
          task: input.task,
          context: input.context,
          budgetMode: record.budgetMode,
          tokenLimit: record.tokenLimit,
          noOp: false,
        };
      } catch (error) {
        logFailure("start_task", input.task, error);
        if (options.policy.mode === "enforce") {
          throw new AIResourceBudgetError("AI_RESOURCE_BUDGET_UNAVAILABLE");
        }
        return noOpTask(input.task, input.context, options.policy.mode, tokenLimit);
      }
    },

    async beforeAttempt(input) {
      const { provider } = parseModelIdentifier(input.model);
      const price = pricing.models[input.model] ?? null;
      const noOp = (): AIAttemptHandle => ({
        id: null,
        taskRunId: input.task.id,
        attemptNumber: input.attemptNumber,
        provider,
        model: input.model,
        credentialTier: input.credentialTier,
        startedAtMs: now(),
        price,
        noOp: true,
      });
      if (input.task.noOp || !input.task.id) {
        if (input.task.budgetMode === "enforce") {
          throw new AIResourceBudgetError("AI_RESOURCE_BUDGET_UNAVAILABLE");
        }
        return noOp();
      }
      if (input.task.budgetMode === "enforce" && unavailableBudgetTasks.has(input.task.id)) {
        throw new AIResourceBudgetError("AI_RESOURCE_BUDGET_UNAVAILABLE");
      }
      try {
        const record = await options.repository.startAttempt({
          taskRunId: input.task.id,
          requestedAttemptNumber: input.attemptNumber,
          provider,
          model: input.model,
          credentialTier: input.credentialTier,
          price,
          budgetMode: input.task.budgetMode,
          budgetScope: input.task.context.budgetScope ?? null,
          tokenLimit: input.task.tokenLimit,
        });
        if (record.rejected) {
          throw new AIResourceBudgetError("AI_RESOURCE_BUDGET_EXCEEDED");
        }
        attemptOwners.set(record.id, {
          task: input.task.task,
          taskRunId: record.taskRunId,
          budgetMode: input.task.budgetMode,
        });
        return {
          id: record.id,
          taskRunId: record.taskRunId,
          attemptNumber: record.attemptNumber,
          provider,
          model: input.model,
          credentialTier: input.credentialTier,
          startedAtMs: now(),
          price,
          noOp: false,
        };
      } catch (error) {
        if (error instanceof AIResourceBudgetError) throw error;
        logFailure("before_attempt", input.task.task, error);
        if (input.task.budgetMode === "enforce") {
          throw new AIResourceBudgetError("AI_RESOURCE_BUDGET_UNAVAILABLE");
        }
        return noOp();
      }
    },

    async completeAttempt(input) {
      if (input.attempt.noOp || !input.attempt.id) return;
      try {
        await options.repository.completeAttempt({
          attemptId: input.attempt.id,
          usage: input.usage,
          price: input.attempt.price,
          estimatedCostMicros: input.usage
            ? calculateAttemptCost(input.usage, input.attempt.price ?? undefined)
            : null,
          firstTokenMs: input.firstTokenMs,
          durationMs: input.durationMs,
        });
      } catch (error) {
        const owner = attemptOwners.get(input.attempt.id);
        logFailure("complete_attempt", owner?.task ?? "resume.parse", error);
        if (owner?.budgetMode === "enforce") unavailableBudgetTasks.add(owner.taskRunId);
      } finally {
        attemptOwners.delete(input.attempt.id);
      }
    },

    async failAttempt(input) {
      if (input.attempt.noOp || !input.attempt.id) return;
      try {
        const sanitized = sanitizeAIError(input.error);
        await options.repository.failAttempt({
          attemptId: input.attempt.id,
          usage: input.usage,
          price: input.attempt.price,
          estimatedCostMicros: input.usage
            ? calculateAttemptCost(input.usage, input.attempt.price ?? undefined)
            : null,
          firstTokenMs: input.firstTokenMs,
          durationMs: input.durationMs,
          errorCategory: sanitized.category,
          retryable: sanitized.retryable,
        });
      } catch (error) {
        const owner = attemptOwners.get(input.attempt.id);
        logFailure("fail_attempt", owner?.task ?? "resume.parse", error);
        if (owner?.budgetMode === "enforce") unavailableBudgetTasks.add(owner.taskRunId);
      } finally {
        attemptOwners.delete(input.attempt.id);
      }
    },

    async completeTask(task) {
      if (task.noOp || !task.id) return;
      try {
        await options.repository.completeTask(task.id);
      } catch (error) {
        logFailure("complete_task", task.task, error);
      } finally {
        unavailableBudgetTasks.delete(task.id);
      }
    },

    async failTask(task, error) {
      if (task.noOp || !task.id) return;
      try {
        await options.repository.failTask(task.id, sanitizeAIError(error));
      } catch (telemetryError) {
        logFailure("fail_task", task.task, telemetryError);
      } finally {
        unavailableBudgetTasks.delete(task.id);
      }
    },
  };
}

function createLazyProductionRepository(): AITelemetryRepository {
  let repository: Promise<AITelemetryRepository> | undefined;
  const get = () => repository ??= import("@/lib/db")
    .then(({ db }) => createDrizzleAITelemetryRepository(db));
  return {
    startOrResumeTask: async (input) => (await get()).startOrResumeTask(input),
    startAttempt: async (input) => (await get()).startAttempt(input),
    completeAttempt: async (input) => (await get()).completeAttempt(input),
    failAttempt: async (input) => (await get()).failAttempt(input),
    completeTask: async (id) => (await get()).completeTask(id),
    failTask: async (id, error) => (await get()).failTask(id, error),
  };
}

export function createProductionAITelemetryLifecycle(input: {
  repository?: AITelemetryRepository;
  policy?: BudgetPolicy;
  pricing?: ModelPricingRegistry;
  env?: Record<string, string | undefined>;
} = {}): AITelemetryLifecycle {
  const env = input.env ?? process.env;
  return createAITelemetryLifecycle({
    repository: input.repository ?? createLazyProductionRepository(),
    policy: input.policy ?? loadAIResourcePolicy(env),
    pricing: input.pricing ?? parseModelPricing(env.AI_MODEL_PRICING_JSON),
  });
}
