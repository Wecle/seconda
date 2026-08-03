import { and, eq, inArray, sql } from "drizzle-orm";
import { aiTaskAttempts, aiTaskRuns } from "@/lib/db/schema";
import type { AITask, AIModelTier, ModelProvider } from "@/lib/ai/model-policy";
import type { BudgetMode } from "./budget";
import { decideBudget } from "./budget";
import type {
  AITaskTelemetryContext,
  AITaskUsage,
  ModelPriceSnapshot,
} from "./types";

type TelemetryDatabase = typeof import("@/lib/db").db;
type TelemetryTransaction = Parameters<Parameters<TelemetryDatabase["transaction"]>[0]>[0];

export type RepositoryTaskRecord = {
  id: string;
  budgetMode: BudgetMode;
  tokenLimit: number | null;
};

export type RepositoryAttemptRecord = {
  id: string;
  taskRunId: string;
  attemptNumber: number;
  rejected: boolean;
  wouldExceed: boolean;
};

export type StartTaskInput = {
  task: AITask;
  context: AITaskTelemetryContext;
  budgetMode: BudgetMode;
  tokenLimit: number | null;
};

export type StartAttemptInput = {
  taskRunId: string;
  requestedAttemptNumber: number;
  provider: ModelProvider;
  model: string;
  credentialTier: AIModelTier;
  price: ModelPriceSnapshot | null;
  budgetMode: BudgetMode;
  budgetScope: string | null;
  tokenLimit: number | null;
};

export type CompleteAttemptInput = {
  attemptId: string;
  usage: AITaskUsage | null;
  price: ModelPriceSnapshot | null;
  estimatedCostMicros: number | null;
  firstTokenMs: number | null;
  durationMs: number;
};

export type FailAttemptInput = CompleteAttemptInput & {
  errorCategory: string;
  retryable: boolean;
};

export interface AITelemetryRepository {
  startOrResumeTask(input: StartTaskInput): Promise<RepositoryTaskRecord>;
  startAttempt(input: StartAttemptInput): Promise<RepositoryAttemptRecord>;
  completeAttempt(input: CompleteAttemptInput): Promise<void>;
  failAttempt(input: FailAttemptInput): Promise<void>;
  completeTask(taskRunId: string): Promise<void>;
  failTask(taskRunId: string, errorJson: unknown): Promise<void>;
}

export function isAttemptUnpriced(
  usage: AITaskUsage | null,
  price: ModelPriceSnapshot | null,
) {
  if (!usage) return false;
  if (!price) return true;
  return (usage.cachedInputTokens !== null && price.cacheReadMicrosPerMillion === undefined)
    || (usage.cacheWriteTokens !== null && price.cacheWriteMicrosPerMillion === undefined);
}

function attemptPriceColumns(price: ModelPriceSnapshot | null) {
  return {
    inputPriceMicrosPerMillion: price?.inputMicrosPerMillion ?? null,
    outputPriceMicrosPerMillion: price?.outputMicrosPerMillion ?? null,
    cacheReadPriceMicrosPerMillion: price?.cacheReadMicrosPerMillion ?? null,
    cacheWritePriceMicrosPerMillion: price?.cacheWriteMicrosPerMillion ?? null,
  };
}

async function nextAttemptNumber(
  tx: TelemetryTransaction,
  taskRunId: string,
  requested: number,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-task:${taskRunId}`}))`);
  const [row] = await tx.select({
    maximum: sql<number>`COALESCE(MAX(${aiTaskAttempts.attemptNumber}), 0)`,
  }).from(aiTaskAttempts).where(eq(aiTaskAttempts.taskRunId, taskRunId));
  return Math.max(requested, Number(row?.maximum ?? 0) + 1);
}

async function usedScopeTokens(tx: TelemetryTransaction, budgetScope: string) {
  const [row] = await tx.select({
    used: sql<number>`COALESCE(SUM(${aiTaskAttempts.inputTokens} + ${aiTaskAttempts.outputTokens}), 0)`,
  }).from(aiTaskAttempts)
    .innerJoin(aiTaskRuns, eq(aiTaskAttempts.taskRunId, aiTaskRuns.id))
    .where(and(
      eq(aiTaskRuns.budgetScope, budgetScope),
      eq(aiTaskAttempts.usageAvailable, 1),
      inArray(aiTaskAttempts.status, ["completed", "failed"]),
    ));
  return Number(row?.used ?? 0);
}

async function finishAttempt(
  tx: TelemetryTransaction,
  input: CompleteAttemptInput,
  terminal: {
    status: "completed" | "failed";
    errorCategory: string | null;
    retryable: number | null;
  },
) {
  const usageAvailable = input.usage ? 1 : 0;
  const [transitioned] = await tx.update(aiTaskAttempts).set({
    status: terminal.status,
    usageAvailable,
    inputTokens: input.usage?.inputTokens ?? 0,
    outputTokens: input.usage?.outputTokens ?? 0,
    cachedInputTokens: input.usage?.cachedInputTokens ?? null,
    cacheWriteTokens: input.usage?.cacheWriteTokens ?? null,
    estimatedCostMicros: input.estimatedCostMicros,
    firstTokenMs: input.firstTokenMs,
    durationMs: input.durationMs,
    errorCategory: terminal.errorCategory,
    retryable: terminal.retryable,
    completedAt: new Date(),
  }).where(and(
    eq(aiTaskAttempts.id, input.attemptId),
    eq(aiTaskAttempts.status, "running"),
  )).returning({ taskRunId: aiTaskAttempts.taskRunId });
  if (!transitioned) return;

  const usage = input.usage;
  await tx.update(aiTaskRuns).set({
    inputTokens: sql`${aiTaskRuns.inputTokens} + ${usage?.inputTokens ?? 0}`,
    outputTokens: sql`${aiTaskRuns.outputTokens} + ${usage?.outputTokens ?? 0}`,
    cachedInputTokens: sql`${aiTaskRuns.cachedInputTokens} + ${usage?.cachedInputTokens ?? 0}`,
    cacheWriteTokens: sql`${aiTaskRuns.cacheWriteTokens} + ${usage?.cacheWriteTokens ?? 0}`,
    usageUnavailableAttempts: sql`${aiTaskRuns.usageUnavailableAttempts} + ${usage ? 0 : 1}`,
    estimatedCostMicros: input.estimatedCostMicros === null
      ? aiTaskRuns.estimatedCostMicros
      : sql`COALESCE(${aiTaskRuns.estimatedCostMicros}, 0) + ${input.estimatedCostMicros}`,
    unpricedAttempts: sql`${aiTaskRuns.unpricedAttempts} + ${isAttemptUnpriced(usage, input.price) ? 1 : 0}`,
    updatedAt: new Date(),
  }).where(eq(aiTaskRuns.id, transitioned.taskRunId));
}

export function createDrizzleAITelemetryRepository(
  database: TelemetryDatabase,
): AITelemetryRepository {
  return {
    async startOrResumeTask(input) {
      const now = new Date();
      const [record] = await database.insert(aiTaskRuns).values({
        operationKey: input.context.operationKey,
        task: input.task,
        status: "running",
        budgetMode: input.budgetMode,
        budgetScope: input.context.budgetScope ?? null,
        tokenLimit: input.tokenLimit,
        interviewId: input.context.interviewId ?? null,
        agentRunId: input.context.agentRunId ?? null,
        questionId: input.context.questionId ?? null,
        completionJobId: input.context.completionJobId ?? null,
        promptTemplateVersion: input.context.promptTemplateVersion ?? null,
      }).onConflictDoUpdate({
        target: aiTaskRuns.operationKey,
        set: {
          status: "running",
          completedAt: null,
          updatedAt: now,
        },
      }).returning({
        id: aiTaskRuns.id,
        budgetMode: aiTaskRuns.budgetMode,
        tokenLimit: aiTaskRuns.tokenLimit,
      });
      if (!record) throw new Error("AI telemetry task could not be started");
      return {
        id: record.id,
        budgetMode: record.budgetMode as BudgetMode,
        tokenLimit: record.tokenLimit,
      };
    },

    async startAttempt(input) {
      return database.transaction(async (tx) => {
        if (input.budgetMode !== "off" && input.budgetScope) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.budgetScope}))`);
        }
        const attemptNumber = await nextAttemptNumber(
          tx,
          input.taskRunId,
          input.requestedAttemptNumber,
        );
        const usedTokens = input.budgetMode !== "off" && input.budgetScope
          ? await usedScopeTokens(tx, input.budgetScope)
          : 0;
        const decision = input.budgetMode === "off" || input.tokenLimit === null || !input.budgetScope
          ? { action: "allow" as const, wouldExceed: false as const }
          : decideBudget({
              mode: input.budgetMode,
              usedTokens,
              tokenLimit: input.tokenLimit,
            });
        const rejected = decision.action === "reject";
        const [attempt] = await tx.insert(aiTaskAttempts).values({
          taskRunId: input.taskRunId,
          attemptNumber,
          provider: input.provider,
          model: input.model,
          credentialTier: input.credentialTier,
          status: rejected ? "budget_rejected" : "running",
          ...attemptPriceColumns(input.price),
          completedAt: rejected ? new Date() : null,
        }).returning({ id: aiTaskAttempts.id });
        if (!attempt) throw new Error("AI telemetry attempt could not be started");
        if (decision.wouldExceed) {
          await tx.update(aiTaskRuns).set({
            wouldExceedBudget: 1,
            ...(rejected ? { status: "budget_exceeded", completedAt: new Date() } : {}),
            updatedAt: new Date(),
          }).where(eq(aiTaskRuns.id, input.taskRunId));
        }
        return {
          id: attempt.id,
          taskRunId: input.taskRunId,
          attemptNumber,
          rejected,
          wouldExceed: decision.wouldExceed,
        };
      });
    },

    completeAttempt(input) {
      return database.transaction((tx) => finishAttempt(tx, input, {
        status: "completed",
        errorCategory: null,
        retryable: null,
      }));
    },

    failAttempt(input) {
      return database.transaction((tx) => finishAttempt(tx, input, {
        status: "failed",
        errorCategory: input.errorCategory,
        retryable: input.retryable ? 1 : 0,
      }));
    },

    async completeTask(taskRunId) {
      await database.update(aiTaskRuns).set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(aiTaskRuns.id, taskRunId),
        eq(aiTaskRuns.status, "running"),
      ));
    },

    async failTask(taskRunId, errorJson) {
      await database.update(aiTaskRuns).set({
        status: "failed",
        errorJson,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(aiTaskRuns.id, taskRunId),
        eq(aiTaskRuns.status, "running"),
      ));
    },
  };
}
