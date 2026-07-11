import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
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

export interface InterviewAgentRepository {
  createRun(input: {
    interviewId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "running"; created: boolean }>;
  appendEvent(
    runId: string,
    event: { type: AgentEventType; payload: unknown },
  ): Promise<{ sequence: number }>;
  appendMessage(input: {
    interviewId: string;
    runId: string;
    role: "user" | "assistant";
    kind: InterviewMessageKind;
    content: string;
    idempotencyKey?: string;
  }): Promise<{ id: string; sequence: number }>;
  loadState(interviewId: string): Promise<InterviewAgentState>;
  saveCheckpoint(runId: string, checkpoint: AgentCheckpoint): Promise<void>;
  completeRun(runId: string, exitReason: AgentExitReason): Promise<void>;
  failRun(
    runId: string,
    exitReason: AgentExitReason,
    error: unknown,
  ): Promise<void>;
}

type MemoryRun = {
  id: string;
  interviewId: string;
  idempotencyKey: string;
  status: "running" | "completed" | "failed";
  eventSequence: number;
  checkpoint?: AgentCheckpoint;
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
      };
      runs.set(run.id, run);
      runKeys.set(key, run.id);
      return { id: run.id, status: "running", created: true };
    },
    async appendEvent(runId) {
      const run = requireMemoryRun(runs, runId);
      run.eventSequence += 1;
      return { sequence: run.eventSequence };
    },
    async appendMessage(input) {
      const key = input.idempotencyKey
        ? `${input.interviewId}:${input.idempotencyKey}`
        : null;
      const existing = key ? messageKeys.get(key) : undefined;
      if (existing) return existing;
      const sequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      messageSequences.set(input.interviewId, sequence);
      const result = { id: `message-${++id}`, sequence };
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
    async completeRun(runId) {
      const run = requireRunningMemoryRun(runs, runId);
      run.status = "completed";
    },
    async failRun(runId) {
      const run = requireRunningMemoryRun(runs, runId);
      run.status = "failed";
    },
    inspectRun(runId) {
      return runs.get(runId);
    },
  };
  return repository;
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
    async completeRun(runId, exitReason) {
      const rows = await database.update(interviewAgentRuns).set({
        status: "completed",
        exitReason,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(interviewAgentRuns.id, runId), eq(interviewAgentRuns.status, "running"))).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error(`Run ${runId} is already terminal`);
    },
    async failRun(runId, exitReason, error) {
      const rows = await database.update(interviewAgentRuns).set({
        status: "failed",
        exitReason,
        errorJson: sanitizeAIError(error),
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(interviewAgentRuns.id, runId), eq(interviewAgentRuns.status, "running"))).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error(`Run ${runId} is already terminal`);
    },
  };
}
