import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  interviewAgentEvents,
  interviewAgentRuns,
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviews,
} from "@/lib/db/schema";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import type {
  AgentCheckpoint,
  AgentEventType,
  AgentExitReason,
  InterviewAgentState,
  InterviewMessageKind,
} from "./contracts";
import { terminalRunPayloadSchema } from "./contracts";

export interface InterviewAgentRepository {
  createRun(input: {
    interviewId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "running"; created: boolean }>;
  appendEvent(
    runId: string,
    event: { type: AgentEventType; payload: unknown },
  ): Promise<{ sequence: number }>;
  getRun(runId: string): Promise<AgentRunRecord | null>;
  listEvents(runId: string, afterSequence: number): Promise<AgentEventRecord[]>;
  claimRun(runId: string, owner: string, now: Date, leaseMs: number): Promise<{ claimed: boolean; run: AgentRunRecord | null }>;
  renewLease(runId: string, owner: string, now: Date, leaseMs: number): Promise<boolean>;
  releaseLease(runId: string, owner: string): Promise<boolean>;
  startAttempt(runId: string, input: {
    model: string;
    attemptId: string;
    attemptNumber: number;
    provisionalMessageId: string;
    now: Date;
  }): Promise<void>;
  recordProviderProgress(runId: string, now: Date): Promise<void>;
  saveRunTrigger(runId: string, trigger: AgentRunTrigger): Promise<void>;
  appendMessage(input: {
    id?: string;
    interviewId: string;
    runId: string;
    role: "user" | "assistant";
    kind: InterviewMessageKind;
    content: string;
    idempotencyKey?: string;
  }): Promise<{ id: string; sequence: number }>;
  loadState(interviewId: string): Promise<InterviewAgentState>;
  saveCheckpoint(runId: string, checkpoint: AgentCheckpoint): Promise<void>;
  terminateRun(runId: string, input: {
    exitReason: AgentExitReason;
    error?: unknown;
    retryable?: boolean;
    userMessage?: string;
  }): Promise<{
    status: "completed" | "failed";
    eventSequence: number;
    created: boolean;
  }>;
  completeRun(runId: string, exitReason: AgentExitReason): Promise<void>;
  failRun(
    runId: string,
    exitReason: AgentExitReason,
    error: unknown,
  ): Promise<void>;
}

export type AgentRunRecord = {
  id: string;
  interviewId: string;
  status: "running" | "completed" | "failed";
  exitReason: AgentExitReason | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  resumeCount: number;
  checkpoint: AgentCheckpoint | null;
  trigger: AgentRunTrigger | null;
  lastEventSequence: number;
};

export type AgentRunTrigger = {
  mode: "opening" | "answer";
  instruction: string;
};

export type AgentEventRecord = {
  sequence: number;
  type: AgentEventType;
  payload: unknown;
};

type MemoryRun = {
  id: string;
  interviewId: string;
  idempotencyKey: string;
  status: "running" | "completed" | "failed";
  eventSequence: number;
  checkpoint?: AgentCheckpoint;
  exitReason: AgentExitReason | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  resumeCount: number;
  events: AgentEventRecord[];
  model: string | null;
  attemptId: string | null;
  attemptNumber: number;
  provisionalMessageId: string | null;
  lastProviderProgressAt: Date | null;
  trigger: AgentRunTrigger | null;
};

export function createInMemoryInterviewAgentRepository(
  initialState?: InterviewAgentState,
) {
  let id = 0;
  const runs = new Map<string, MemoryRun>();
  const runKeys = new Map<string, string>();
  const messageKeys = new Map<string, { id: string; sequence: number }>();
  const messageSequences = new Map<string, number>();
  const states = new Map<string, InterviewAgentState>();

  if (initialState) states.set(initialState.interviewId, initialState);

  const repository: InterviewAgentRepository & {
    inspectRun(runId: string): MemoryRun | undefined;
  } = {
    async createRun(input) {
      const key = `${input.interviewId}:${input.idempotencyKey}`;
      const existingId = runKeys.get(key);
      if (existingId) return { id: existingId, status: "running", created: false };
      const run: MemoryRun = {
        id: `run-${++id}`,
        interviewId: input.interviewId,
        idempotencyKey: input.idempotencyKey,
        status: "running",
        eventSequence: 0,
        exitReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        resumeCount: 0,
        events: [],
        model: null,
        attemptId: null,
        attemptNumber: 0,
        provisionalMessageId: null,
        lastProviderProgressAt: null,
        trigger: null,
      };
      runs.set(run.id, run);
      runKeys.set(key, run.id);
      return { id: run.id, status: "running", created: true };
    },
    async appendEvent(runId, event) {
      const run = requireMemoryRun(runs, runId);
      run.eventSequence += 1;
      run.events.push({ sequence: run.eventSequence, ...event });
      return { sequence: run.eventSequence };
    },
    async getRun(runId) {
      const run = runs.get(runId);
      return run ? memoryRunRecord(run) : null;
    },
    async listEvents(runId, afterSequence) {
      return requireMemoryRun(runs, runId).events.filter((event) => event.sequence > afterSequence);
    },
    async claimRun(runId, owner, now, leaseMs) {
      const run = requireMemoryRun(runs, runId);
      if (run.status !== "running") return { claimed: false, run: memoryRunRecord(run) };
      const sameOwner = run.leaseOwner === owner;
      const expired = !run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= now.getTime();
      if (!sameOwner && !expired) return { claimed: false, run: memoryRunRecord(run) };
      if (run.leaseOwner && run.leaseOwner !== owner && expired) run.resumeCount += 1;
      run.leaseOwner = owner;
      run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return { claimed: true, run: memoryRunRecord(run) };
    },
    async renewLease(runId, owner, now, leaseMs) {
      const run = requireMemoryRun(runs, runId);
      if (run.status !== "running" || run.leaseOwner !== owner) return false;
      run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return true;
    },
    async releaseLease(runId, owner) {
      const run = requireMemoryRun(runs, runId);
      if (run.leaseOwner !== owner) return false;
      run.leaseOwner = null;
      run.leaseExpiresAt = null;
      return true;
    },
    async startAttempt(runId, input) {
      const run = requireRunningMemoryRun(runs, runId);
      run.model = input.model;
      run.attemptId = input.attemptId;
      run.attemptNumber = input.attemptNumber;
      run.provisionalMessageId = input.provisionalMessageId;
      run.lastProviderProgressAt = input.now;
    },
    async recordProviderProgress(runId, now) {
      requireRunningMemoryRun(runs, runId).lastProviderProgressAt = now;
    },
    async saveRunTrigger(runId, trigger) {
      requireRunningMemoryRun(runs, runId).trigger = trigger;
    },
    async appendMessage(input) {
      const key = input.idempotencyKey
        ? `${input.interviewId}:${input.idempotencyKey}`
        : null;
      const existing = key ? messageKeys.get(key) : undefined;
      if (existing) return existing;
      const sequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      messageSequences.set(input.interviewId, sequence);
      const result = { id: input.id ?? `message-${++id}`, sequence };
      if (key) messageKeys.set(key, result);
      return result;
    },
    async loadState(interviewId) {
      return (
        states.get(interviewId) ?? {
          interviewId,
          candidateRoundCount: 0,
          categoryCounts: {},
          recentQuestions: [],
          requestedUserEnd: false,
        }
      );
    },
    async saveCheckpoint(runId, checkpoint) {
      requireMemoryRun(runs, runId).checkpoint = checkpoint;
    },
    async terminateRun(runId, input) {
      const run = requireMemoryRun(runs, runId);
      if (run.status !== "running") {
        return { status: run.status, eventSequence: run.eventSequence, created: false };
      }
      const completed = input.exitReason === "completed";
      run.eventSequence += 1;
      run.events.push({
        sequence: run.eventSequence,
        type: completed ? "run_completed" : "run_failed",
        payload: buildTerminalPayload(runId, input),
      });
      run.status = completed ? "completed" : "failed";
      run.exitReason = input.exitReason;
      run.leaseOwner = null;
      run.leaseExpiresAt = null;
      return { status: run.status, eventSequence: run.eventSequence, created: true };
    },
    async completeRun(runId) {
      const result = await this.terminateRun(runId, { exitReason: "completed" });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
    async failRun(runId, exitReason, error) {
      const result = await this.terminateRun(runId, { exitReason, error });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
    inspectRun(runId) {
      return runs.get(runId);
    },
  };
  return repository;
}

function memoryRunRecord(run: MemoryRun): AgentRunRecord {
  return {
    id: run.id,
    interviewId: run.interviewId,
    status: run.status,
    exitReason: run.exitReason,
    leaseOwner: run.leaseOwner,
    leaseExpiresAt: run.leaseExpiresAt,
    resumeCount: run.resumeCount,
    checkpoint: run.checkpoint ?? null,
    trigger: run.trigger,
    lastEventSequence: run.eventSequence,
  };
}

function requireMemoryRun(runs: Map<string, MemoryRun>, runId: string) {
  const run = runs.get(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  return run;
}

function requireRunningMemoryRun(runs: Map<string, MemoryRun>, runId: string) {
  const run = requireMemoryRun(runs, runId);
  if (run.status !== "running") throw new Error(`Run ${runId} is already terminal`);
  return run;
}

type AgentDatabase = typeof import("@/lib/db").db;

export function createDrizzleInterviewAgentRepository(
  database: AgentDatabase,
): InterviewAgentRepository {
  return {
    async createRun(input) {
      const [existing] = await database
        .select({ id: interviewAgentRuns.id })
        .from(interviewAgentRuns)
        .where(and(
          eq(interviewAgentRuns.interviewId, input.interviewId),
          eq(interviewAgentRuns.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (existing) return { id: existing.id, status: "running", created: false };

      const [created] = await database
        .insert(interviewAgentRuns)
        .values(input)
        .onConflictDoNothing({
          target: [
            interviewAgentRuns.interviewId,
            interviewAgentRuns.idempotencyKey,
          ],
        })
        .returning({ id: interviewAgentRuns.id });
      if (created) {
        return { id: created.id, status: "running", created: true };
      }
      const [winner] = await database
        .select({ id: interviewAgentRuns.id })
        .from(interviewAgentRuns)
        .where(and(
          eq(interviewAgentRuns.interviewId, input.interviewId),
          eq(interviewAgentRuns.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (!winner) throw new Error("Idempotent Agent run could not be resolved");
      return { id: winner.id, status: "running", created: false };
    },
    async appendEvent(runId, event) {
      return database.transaction(async (tx) => {
        const [run] = await tx
          .update(interviewAgentRuns)
          .set({
            lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(interviewAgentRuns.id, runId))
          .returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!run) throw new Error(`Unknown run: ${runId}`);
        await tx.insert(interviewAgentEvents).values({
          runId,
          sequence: run.sequence,
          type: event.type,
          payload: event.payload,
        });
        return run;
      });
    },
    async getRun(runId) {
      const [run] = await database.select({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
        status: interviewAgentRuns.status,
        exitReason: interviewAgentRuns.exitReason,
        leaseOwner: interviewAgentRuns.leaseOwner,
        leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
        resumeCount: interviewAgentRuns.resumeCount,
        checkpoint: interviewAgentRuns.checkpointJson,
        trigger: interviewAgentRuns.triggerJson,
        lastEventSequence: interviewAgentRuns.lastEventSequence,
      }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId)).limit(1);
      return run ? parseRunRecord(run) : null;
    },
    async listEvents(runId, afterSequence) {
      const rows = await database.select({
        sequence: interviewAgentEvents.sequence,
        type: interviewAgentEvents.type,
        payload: interviewAgentEvents.payload,
      }).from(interviewAgentEvents)
        .where(and(eq(interviewAgentEvents.runId, runId), sql`${interviewAgentEvents.sequence} > ${afterSequence}`))
        .orderBy(asc(interviewAgentEvents.sequence));
      return rows as AgentEventRecord[];
    },
    async claimRun(runId, owner, now, leaseMs) {
      const expiresAt = new Date(now.getTime() + leaseMs);
      const [claimed] = await database.update(interviewAgentRuns).set({
        resumeCount: sql`CASE WHEN ${interviewAgentRuns.leaseOwner} IS NOT NULL AND ${interviewAgentRuns.leaseOwner} <> ${owner} THEN ${interviewAgentRuns.resumeCount} + 1 ELSE ${interviewAgentRuns.resumeCount} END`,
        leaseOwner: owner,
        leaseExpiresAt: expiresAt,
        updatedAt: now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
        or(
          isNull(interviewAgentRuns.leaseExpiresAt),
          lte(interviewAgentRuns.leaseExpiresAt, now),
          eq(interviewAgentRuns.leaseOwner, owner),
        ),
      )).returning({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
        status: interviewAgentRuns.status,
        exitReason: interviewAgentRuns.exitReason,
        leaseOwner: interviewAgentRuns.leaseOwner,
        leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
        resumeCount: interviewAgentRuns.resumeCount,
        checkpoint: interviewAgentRuns.checkpointJson,
        trigger: interviewAgentRuns.triggerJson,
        lastEventSequence: interviewAgentRuns.lastEventSequence,
      });
      if (claimed) return { claimed: true, run: parseRunRecord(claimed) };
      return { claimed: false, run: await this.getRun(runId) };
    },
    async renewLease(runId, owner, now, leaseMs) {
      const rows = await database.update(interviewAgentRuns).set({
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
        eq(interviewAgentRuns.leaseOwner, owner),
      )).returning({ id: interviewAgentRuns.id });
      return rows.length > 0;
    },
    async releaseLease(runId, owner) {
      const rows = await database.update(interviewAgentRuns).set({
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(and(eq(interviewAgentRuns.id, runId), eq(interviewAgentRuns.leaseOwner, owner)))
        .returning({ id: interviewAgentRuns.id });
      return rows.length > 0;
    },
    async startAttempt(runId, input) {
      await database.update(interviewAgentRuns).set({
        model: input.model,
        attemptId: input.attemptId,
        attemptNumber: input.attemptNumber,
        provisionalMessageId: input.provisionalMessageId,
        lastProviderProgressAt: input.now,
        updatedAt: input.now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
      ));
    },
    async recordProviderProgress(runId, now) {
      await database.update(interviewAgentRuns).set({
        lastProviderProgressAt: now,
        updatedAt: now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
      ));
    },
    async saveRunTrigger(runId, trigger) {
      await database.update(interviewAgentRuns).set({
        triggerJson: trigger,
        updatedAt: new Date(),
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
      ));
    },
    async appendMessage(input) {
      if (input.idempotencyKey) {
        const [existing] = await database
          .select({ id: interviewMessages.id, sequence: interviewMessages.sequence })
          .from(interviewMessages)
          .where(and(
            eq(interviewMessages.interviewId, input.interviewId),
            eq(interviewMessages.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        if (existing) return existing;
      }

      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        const [row] = await tx
          .select({ sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1` })
          .from(interviewMessages)
          .where(eq(interviewMessages.interviewId, input.interviewId));
        const [created] = await tx
          .insert(interviewMessages)
          .values({ ...input, sequence: Number(row.sequence) })
          .returning({ id: interviewMessages.id, sequence: interviewMessages.sequence });
        return created;
      });
    },
    async loadState(interviewId) {
      const [interview] = await database
        .select({ candidateRoundCount: interviews.candidateRoundCount, status: interviews.status })
        .from(interviews)
        .where(eq(interviews.id, interviewId))
        .limit(1);
      if (!interview) throw new Error(`Unknown interview: ${interviewId}`);

      const [coverage, questions] = await Promise.all([
        database.select({ category: interviewCoverage.category, questionCount: interviewCoverage.questionCount })
          .from(interviewCoverage)
          .where(eq(interviewCoverage.interviewId, interviewId)),
        database.select({ question: interviewQuestions.question })
          .from(interviewQuestions)
          .where(and(eq(interviewQuestions.interviewId, interviewId), isNotNull(interviewQuestions.askedAt)))
          .orderBy(asc(interviewQuestions.questionIndex)),
      ]);
      return {
        interviewId,
        candidateRoundCount: interview.candidateRoundCount,
        categoryCounts: Object.fromEntries(coverage.map((item) => [item.category, item.questionCount])),
        recentQuestions: questions.slice(-10).map((item) => item.question),
        requestedUserEnd: interview.status === "completing",
      } as InterviewAgentState;
    },
    async saveCheckpoint(runId, checkpoint) {
      await database.update(interviewAgentRuns).set({
        checkpointJson: checkpoint,
        turnCount: checkpoint.turnCount,
        updatedAt: new Date(),
      }).where(eq(interviewAgentRuns.id, runId));
    },
    async terminateRun(runId, input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
        const [current] = await tx.select({
          status: interviewAgentRuns.status,
          lastEventSequence: interviewAgentRuns.lastEventSequence,
        }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId)).limit(1);
        if (!current) throw new Error(`Unknown run: ${runId}`);
        if (current.status !== "running") {
          return {
            status: current.status as "completed" | "failed",
            eventSequence: current.lastEventSequence,
            created: false,
          };
        }
        const completed = input.exitReason === "completed";
        const now = new Date();
        const [updated] = await tx.update(interviewAgentRuns).set({
          status: completed ? "completed" : "failed",
          exitReason: input.exitReason,
          errorJson: completed ? null : sanitizeAIError(input.error),
          lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
          completedAt: now,
          updatedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        }).where(and(
          eq(interviewAgentRuns.id, runId),
          eq(interviewAgentRuns.status, "running"),
        )).returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!updated) throw new Error(`Run ${runId} termination lost its lock`);
        await tx.insert(interviewAgentEvents).values({
          runId,
          sequence: updated.sequence,
          type: completed ? "run_completed" : "run_failed",
          payload: buildTerminalPayload(runId, input),
        });
        return {
          status: completed ? "completed" as const : "failed" as const,
          eventSequence: updated.sequence,
          created: true,
        };
      });
    },
    async completeRun(runId, exitReason) {
      const result = await this.terminateRun(runId, { exitReason });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
    async failRun(runId, exitReason, error) {
      const result = await this.terminateRun(runId, { exitReason, error });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
  };
}

function parseRunRecord(row: {
  id: string;
  interviewId: string;
  status: string;
  exitReason: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  resumeCount: number;
  checkpoint: unknown;
  trigger: unknown;
  lastEventSequence: number;
}): AgentRunRecord {
  return {
    ...row,
    status: row.status as AgentRunRecord["status"],
    exitReason: row.exitReason as AgentExitReason | null,
    checkpoint: row.checkpoint as AgentCheckpoint | null,
    trigger: row.trigger as AgentRunTrigger | null,
  };
}

function buildTerminalPayload(
  runId: string,
  input: {
    exitReason: AgentExitReason;
    retryable?: boolean;
    userMessage?: string;
  },
) {
  return terminalRunPayloadSchema.parse({
    runId,
    exitReason: input.exitReason,
    retryable: input.retryable ?? input.exitReason === "aborted_streaming",
    userMessage: input.userMessage ?? defaultExitMessage(input.exitReason),
  });
}

function defaultExitMessage(reason: AgentExitReason) {
  const messages: Record<AgentExitReason, string> = {
    completed: "本轮处理已完成。",
    max_turns: "本轮处理达到最大步骤数，请重试。",
    provider_failed: "模型服务暂时不可用，请稍后重试。",
    terminal_action_failed: "本轮问题生成未能通过运行规则，请重试。",
    aborted_streaming: "模型连接中断，请重试本轮回答。",
    aborted_tools: "后台操作中断，请重试。",
    hook_stopped: "本轮处理被安全规则终止。",
    blocking_limit: "本轮处理持续没有进展，已停止运行。",
    prompt_too_long: "面试上下文过长，暂时无法继续。",
  };
  return messages[reason];
}
