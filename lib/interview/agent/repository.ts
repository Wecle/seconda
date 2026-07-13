import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  interviewAnswerAssessments,
  interviewAgentEvents,
  interviewAgentRuns,
  interviewAgentToolCommits,
  interviewCompletionJobs,
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
import { agentExitMessage } from "./exit-messages";
import { terminalRunPayloadSchema } from "./contracts";

export const MAX_AGENT_RUN_RESUMES = 2;

export interface InterviewAgentRepository {
  createRun(input: {
    interviewId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "running"; created: boolean }>;
  appendEvent(
    runId: string,
    event: { type: AgentEventType; payload: unknown; dedupeKey?: string },
    lease?: RunLeaseToken,
  ): Promise<{ sequence: number }>;
  getRun(runId: string): Promise<AgentRunRecord | null>;
  listEvents(runId: string, afterSequence: number): Promise<AgentEventRecord[]>;
  claimRun(runId: string, owner: string, now: Date, leaseMs: number): Promise<{ claimed: boolean; run: AgentRunRecord | null }>;
  renewLease(runId: string, lease: RunLeaseToken, now: Date, leaseMs: number): Promise<boolean>;
  releaseLease(runId: string, lease: RunLeaseToken): Promise<boolean>;
  startAttempt(runId: string, input: {
    model: string;
    attemptId: string;
    attemptNumber: number;
    provisionalMessageId: string;
    now: Date;
  }, lease?: RunLeaseToken): Promise<void>;
  recordProviderProgress(runId: string, now: Date, lease?: RunLeaseToken): Promise<void>;
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
  saveCheckpoint(runId: string, checkpoint: AgentCheckpoint, lease?: RunLeaseToken): Promise<void>;
  terminateRun(runId: string, input: {
    exitReason: AgentExitReason;
    error?: unknown;
    retryable?: boolean;
    userMessage?: string;
  }, lease?: RunLeaseToken): Promise<{
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
  commitQuestionOutcome(input: QuestionOutcomeInput): Promise<QuestionOutcome>;
  commitCoverageUpdate(input: CoverageUpdateInput): Promise<{ updated: true }>;
  commitFinishOutcome(input: FinishOutcomeInput): Promise<FinishOutcome>;
  markInterviewCompleting(interviewId: string): Promise<{ changed: boolean; invalidatedRunIds: string[] }>;
}

export type RunLeaseToken = {
  owner: string;
  generation: number;
};

export type QuestionOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  category: string;
  topic: string;
  question: string;
  responseText: string;
  resumeEvidenceIds: string[];
  provisionalMessageId?: string;
  targetRole?: {
    value: string;
    status: "inferred" | "confirmed";
    confidence: "low" | "medium" | "high";
    sourceIds: string[];
  };
};

export type QuestionOutcome = {
  questionId: string;
  messageId: string;
  messageSequence: number;
  responseText: string;
  committed: true;
};

export type CoverageUpdateInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  category: string;
  topic: string;
  status: string;
  resumeEvidenceIds: string[];
};

export type FinishOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  closingMessage: string;
};

export type FinishOutcome = {
  messageId: string;
  messageSequence: number;
  responseText: string;
  committed: true;
};

export type AgentRunRecord = {
  id: string;
  interviewId: string;
  status: "running" | "completed" | "failed";
  exitReason: AgentExitReason | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseGeneration: number;
  resumeCount: number;
  nextResumeAt: Date | null;
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
  leaseGeneration: number;
  resumeCount: number;
  nextResumeAt: Date | null;
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
  const interviewQuestionsById = new Map<string, Array<{ id: string; category: string; topic: string; question: string }>>();
  const interviewMessagesById = new Map<string, Array<{ id: string; runId: string; questionId: string; content: string; sequence: number }>>();
  const categoryCountsByInterview = new Map<string, Record<string, number>>();
  const targetRoleByInterview = new Map<string, QuestionOutcomeInput["targetRole"]>();
  const toolCommits = new Map<string, unknown>();
  const completingInterviews = new Set<string>();
  const states = new Map<string, InterviewAgentState>();

  if (initialState) states.set(initialState.interviewId, initialState);

  const repository: InterviewAgentRepository & {
    inspectRun(runId: string): MemoryRun | undefined;
    inspectInterview(interviewId: string): {
      status: "active" | "completing";
      questions: Array<{ id: string; category: string; topic: string; question: string }>;
      messages: Array<{ id: string; runId: string; questionId: string; content: string; sequence: number }>;
      categoryCounts: Record<string, number>;
      targetRole: QuestionOutcomeInput["targetRole"];
    };
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
        leaseGeneration: 0,
        resumeCount: 0,
        nextResumeAt: null,
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
    async appendEvent(runId, event, lease) {
      const run = requireMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      if (event.dedupeKey) {
        const existing = run.events.find((candidate) => (
          (candidate as AgentEventRecord & { dedupeKey?: string }).dedupeKey === event.dedupeKey
        ));
        if (existing) return { sequence: existing.sequence };
      }
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
      const recovering = isRecoverableFailedRun(run);
      if (run.status !== "running" && !recovering) return { claimed: false, run: memoryRunRecord(run) };
      const expired = !run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= now.getTime();
      if (!recovering && !expired) return { claimed: false, run: memoryRunRecord(run) };
      const retrying = recovering || Boolean(run.leaseOwner && expired);
      if (retrying && run.resumeCount >= MAX_AGENT_RUN_RESUMES) {
        return { claimed: false, run: memoryRunRecord(run) };
      }
      if (recovering && run.nextResumeAt && run.nextResumeAt.getTime() > now.getTime()) {
        return { claimed: false, run: memoryRunRecord(run) };
      }
      if (retrying) run.resumeCount += 1;
      run.leaseGeneration += 1;
      if (recovering) {
        run.status = "running";
        run.exitReason = null;
        run.nextResumeAt = null;
      }
      run.leaseOwner = owner;
      run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return { claimed: true, run: memoryRunRecord(run) };
    },
    async renewLease(runId, lease, now, leaseMs) {
      const run = requireMemoryRun(runs, runId);
      if (run.status !== "running" || run.leaseOwner !== lease.owner || run.leaseGeneration !== lease.generation || !run.leaseExpiresAt || run.leaseExpiresAt <= now) return false;
      run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return true;
    },
    async releaseLease(runId, lease) {
      const run = requireMemoryRun(runs, runId);
      if (run.leaseOwner !== lease.owner || run.leaseGeneration !== lease.generation) return false;
      run.leaseOwner = null;
      run.leaseExpiresAt = null;
      return true;
    },
    async startAttempt(runId, input, lease) {
      const run = requireRunningMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      run.model = input.model;
      run.attemptId = input.attemptId;
      run.attemptNumber = input.attemptNumber;
      run.provisionalMessageId = input.provisionalMessageId;
      run.lastProviderProgressAt = input.now;
    },
    async recordProviderProgress(runId, now, lease) {
      const run = requireRunningMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      run.lastProviderProgressAt = now;
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
    async saveCheckpoint(runId, checkpoint, lease) {
      const run = requireMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      run.checkpoint = checkpoint;
    },
    async terminateRun(runId, input, lease) {
      const run = requireMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
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
      run.nextResumeAt = !completed && RECOVERABLE_RUN_EXIT_REASONS.includes(input.exitReason)
        && run.resumeCount < MAX_AGENT_RUN_RESUMES
        ? new Date(Date.now() + Math.min(300_000, 30_000 * (2 ** run.resumeCount)))
        : null;
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
    async commitQuestionOutcome(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryFence(run, input.lease);
      const key = `${input.runId}:${input.toolCallId}`;
      const existing = toolCommits.get(key);
      if (existing) return existing as QuestionOutcome;
      const counts = categoryCountsByInterview.get(input.interviewId) ?? {};
      if ((counts[input.category] ?? 0) >= 3) throw new Error("CATEGORY_LIMIT_REACHED");
      const questionId = `question-${++id}`;
      const messageId = input.provisionalMessageId ?? `message-${++id}`;
      const sequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      const outcome: QuestionOutcome = {
        questionId,
        messageId,
        messageSequence: sequence,
        responseText: input.responseText,
        committed: true,
      };
      interviewQuestionsById.set(input.interviewId, [
        ...(interviewQuestionsById.get(input.interviewId) ?? []),
        { id: questionId, category: input.category, topic: input.topic, question: input.question },
      ]);
      interviewMessagesById.set(input.interviewId, [
        ...(interviewMessagesById.get(input.interviewId) ?? []),
        { id: messageId, runId: input.runId, questionId, content: input.responseText, sequence },
      ]);
      messageSequences.set(input.interviewId, sequence);
      categoryCountsByInterview.set(input.interviewId, { ...counts, [input.category]: (counts[input.category] ?? 0) + 1 });
      if (input.targetRole) targetRoleByInterview.set(input.interviewId, input.targetRole);
      toolCommits.set(key, outcome);
      return outcome;
    },
    async commitCoverageUpdate(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryFence(run, input.lease);
      const key = `${input.runId}:${input.toolCallId}`;
      const existing = toolCommits.get(key);
      if (existing) return existing as { updated: true };
      const result = { updated: true as const };
      toolCommits.set(key, result);
      return result;
    },
    async commitFinishOutcome(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryFence(run, input.lease);
      const key = `${input.runId}:${input.toolCallId}`;
      const existing = toolCommits.get(key);
      if (existing) return existing as FinishOutcome;
      const sequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      const outcome: FinishOutcome = {
        messageId: `message-${++id}`,
        messageSequence: sequence,
        responseText: input.closingMessage,
        committed: true,
      };
      interviewMessagesById.set(input.interviewId, [
        ...(interviewMessagesById.get(input.interviewId) ?? []),
        {
          id: outcome.messageId,
          runId: input.runId,
          questionId: "",
          content: input.closingMessage,
          sequence,
        },
      ]);
      messageSequences.set(input.interviewId, sequence);
      completingInterviews.add(input.interviewId);
      toolCommits.set(key, outcome);
      return outcome;
    },
    async markInterviewCompleting(interviewId) {
      if (completingInterviews.has(interviewId)) {
        return { changed: false, invalidatedRunIds: [] };
      }
      completingInterviews.add(interviewId);
      const invalidatedRunIds: string[] = [];
      for (const run of runs.values()) {
        if (run.interviewId !== interviewId || run.status !== "running") continue;
        await repository.terminateRun(run.id, {
          exitReason: "aborted_tools",
          error: new Error("Interview ended by user"),
          userMessage: "用户已结束面试。",
        });
        run.leaseGeneration += 1;
        invalidatedRunIds.push(run.id);
      }
      return { changed: true, invalidatedRunIds };
    },
    inspectRun(runId) {
      return runs.get(runId);
    },
    inspectInterview(interviewId: string) {
      return {
        status: completingInterviews.has(interviewId) ? "completing" : "active",
        questions: interviewQuestionsById.get(interviewId) ?? [],
        messages: interviewMessagesById.get(interviewId) ?? [],
        categoryCounts: categoryCountsByInterview.get(interviewId) ?? {},
        targetRole: targetRoleByInterview.get(interviewId),
      };
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
    leaseGeneration: run.leaseGeneration,
    resumeCount: run.resumeCount,
    nextResumeAt: run.nextResumeAt,
    checkpoint: run.checkpoint ?? null,
    trigger: run.trigger,
    lastEventSequence: run.eventSequence,
  };
}

function assertMemoryFence(run: MemoryRun, lease?: RunLeaseToken) {
  if (!lease) return;
  if (
    run.status !== "running" ||
    run.leaseOwner !== lease.owner ||
    run.leaseGeneration !== lease.generation
  ) {
    throw new Error("Agent run lease is stale");
  }
}

const RECOVERABLE_RUN_EXIT_REASONS: AgentExitReason[] = [
  "aborted_streaming",
  "provider_failed",
  "prompt_too_long",
];

function isRecoverableFailedRun(run: Pick<MemoryRun, "status" | "exitReason" | "trigger">) {
  return run.status === "failed"
    && run.trigger !== null
    && run.exitReason !== null
    && RECOVERABLE_RUN_EXIT_REASONS.includes(run.exitReason);
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
    async appendEvent(runId, event, lease) {
      return database.transaction(async (tx) => {
        const [writableRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(runId, lease))
          .limit(1);
        if (!writableRun) throw new Error("Agent run lease is stale");
        if (event.dedupeKey) {
          const [existing] = await tx.select({ sequence: interviewAgentEvents.sequence })
            .from(interviewAgentEvents)
            .where(and(
              eq(interviewAgentEvents.runId, runId),
              eq(interviewAgentEvents.dedupeKey, event.dedupeKey),
            ))
            .limit(1);
          if (existing) return existing;
        }
        const [run] = await tx
          .update(interviewAgentRuns)
          .set({
            lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
            updatedAt: new Date(),
          })
          .where(runFenceCondition(runId, lease))
          .returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!run) throw new Error(`Unknown run: ${runId}`);
        await tx.insert(interviewAgentEvents).values({
          runId,
          sequence: run.sequence,
          dedupeKey: event.dedupeKey,
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
        leaseGeneration: interviewAgentRuns.leaseGeneration,
        resumeCount: interviewAgentRuns.resumeCount,
        nextResumeAt: interviewAgentRuns.nextResumeAt,
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
        status: "running",
        exitReason: null,
        errorJson: null,
        completedAt: null,
        resumeCount: sql`CASE WHEN ${interviewAgentRuns.status} = 'failed' OR ${interviewAgentRuns.leaseOwner} IS NOT NULL THEN ${interviewAgentRuns.resumeCount} + 1 ELSE ${interviewAgentRuns.resumeCount} END`,
        nextResumeAt: null,
        leaseOwner: owner,
        leaseExpiresAt: expiresAt,
        leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
        updatedAt: now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        or(
          and(
            eq(interviewAgentRuns.status, "running"),
            or(
              isNull(interviewAgentRuns.leaseExpiresAt),
              lte(interviewAgentRuns.leaseExpiresAt, now),
            ),
            or(
              isNull(interviewAgentRuns.leaseOwner),
              sql`${interviewAgentRuns.resumeCount} < ${MAX_AGENT_RUN_RESUMES}`,
            ),
          ),
          and(
            eq(interviewAgentRuns.status, "failed"),
            inArray(interviewAgentRuns.exitReason, RECOVERABLE_RUN_EXIT_REASONS),
            isNotNull(interviewAgentRuns.triggerJson),
            sql`${interviewAgentRuns.resumeCount} < ${MAX_AGENT_RUN_RESUMES}`,
            or(
              isNull(interviewAgentRuns.nextResumeAt),
              lte(interviewAgentRuns.nextResumeAt, now),
            ),
          ),
        ),
      )).returning({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
        status: interviewAgentRuns.status,
        exitReason: interviewAgentRuns.exitReason,
        leaseOwner: interviewAgentRuns.leaseOwner,
        leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
        leaseGeneration: interviewAgentRuns.leaseGeneration,
        resumeCount: interviewAgentRuns.resumeCount,
        nextResumeAt: interviewAgentRuns.nextResumeAt,
        checkpoint: interviewAgentRuns.checkpointJson,
        trigger: interviewAgentRuns.triggerJson,
        lastEventSequence: interviewAgentRuns.lastEventSequence,
      });
      if (claimed) return { claimed: true, run: parseRunRecord(claimed) };
      return { claimed: false, run: await this.getRun(runId) };
    },
    async renewLease(runId, lease, now, leaseMs) {
      const rows = await database.update(interviewAgentRuns).set({
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
        eq(interviewAgentRuns.leaseOwner, lease.owner),
        eq(interviewAgentRuns.leaseGeneration, lease.generation),
        gt(interviewAgentRuns.leaseExpiresAt, now),
      )).returning({ id: interviewAgentRuns.id });
      return rows.length > 0;
    },
    async releaseLease(runId, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.leaseOwner, lease.owner),
        eq(interviewAgentRuns.leaseGeneration, lease.generation),
      ))
        .returning({ id: interviewAgentRuns.id });
      return rows.length > 0;
    },
    async startAttempt(runId, input, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        model: input.model,
        attemptId: input.attemptId,
        attemptNumber: input.attemptNumber,
        provisionalMessageId: input.provisionalMessageId,
        lastProviderProgressAt: input.now,
        updatedAt: input.now,
      }).where(runFenceCondition(runId, lease)).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent run lease is stale");
    },
    async recordProviderProgress(runId, now, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        lastProviderProgressAt: now,
        updatedAt: now,
      }).where(runFenceCondition(runId, lease)).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent run lease is stale");
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

      const [coverage, questions, assessments] = await Promise.all([
        database.select({
          category: interviewCoverage.category,
          questionCount: interviewCoverage.questionCount,
          status: interviewCoverage.status,
        })
          .from(interviewCoverage)
          .where(and(
            eq(interviewCoverage.interviewId, interviewId),
            eq(interviewCoverage.topic, "__category__"),
          )),
        database.select({ question: interviewQuestions.question })
          .from(interviewQuestions)
          .where(and(eq(interviewQuestions.interviewId, interviewId), isNotNull(interviewQuestions.askedAt)))
          .orderBy(asc(interviewQuestions.questionIndex)),
        database.select({ followUpNeeded: interviewAnswerAssessments.followUpNeeded })
          .from(interviewAnswerAssessments)
          .where(eq(interviewAnswerAssessments.interviewId, interviewId))
          .orderBy(desc(interviewAnswerAssessments.createdAt))
          .limit(2),
      ]);
      return {
        interviewId,
        candidateRoundCount: interview.candidateRoundCount,
        categoryCounts: Object.fromEntries(coverage.map((item) => [item.category, item.questionCount])),
        categoryStatuses: Object.fromEntries(coverage.map((item) => [item.category, item.status])),
        consecutiveNoFollowUpAssessments: assessments.findIndex((item) => item.followUpNeeded !== 0) === -1
          ? assessments.length
          : assessments.findIndex((item) => item.followUpNeeded !== 0),
        recentQuestions: questions.slice(-10).map((item) => item.question),
        requestedUserEnd: interview.status === "completing",
      } as InterviewAgentState;
    },
    async saveCheckpoint(runId, checkpoint, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        checkpointJson: checkpoint,
        turnCount: checkpoint.turnCount,
        updatedAt: new Date(),
      }).where(runFenceCondition(runId, lease)).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent run lease is stale");
    },
    async terminateRun(runId, input, lease) {
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
          nextResumeAt: !completed && RECOVERABLE_RUN_EXIT_REASONS.includes(input.exitReason)
            ? sql`CASE WHEN ${interviewAgentRuns.resumeCount} >= ${MAX_AGENT_RUN_RESUMES} THEN NULL ELSE ${now} + LEAST(300000, 30000 * POWER(2, ${interviewAgentRuns.resumeCount})) * INTERVAL '1 millisecond' END`
            : null,
        }).where(runFenceCondition(runId, lease)).returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!updated) throw new Error("Agent run lease is stale");
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
    async commitQuestionOutcome(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);
        const [leasedRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(input.runId, input.lease))
          .limit(1);
        if (!leasedRun) throw new Error("Agent run lease is stale");
        const [existing] = await tx.select({ result: interviewAgentToolCommits.resultJson })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) return existing.result as QuestionOutcome;
        const [interview] = await tx.select({ status: interviews.status })
          .from(interviews)
          .where(eq(interviews.id, input.interviewId))
          .limit(1);
        if (interview?.status !== "active") throw new Error("INTERVIEW_NOT_ACTIVE");
        if (input.targetRole) {
          await tx.update(interviews).set({
            targetRole: input.targetRole.value,
            targetRoleStatus: input.targetRole.status,
            targetRoleConfidence: input.targetRole.confidence,
            targetRoleSourceIds: input.targetRole.sourceIds,
            updatedAt: new Date(),
          }).where(and(
            eq(interviews.id, input.interviewId),
            eq(interviews.status, "active"),
          ));
        }
        const [coverage] = await tx.select({ count: interviewCoverage.questionCount })
          .from(interviewCoverage)
          .where(and(
            eq(interviewCoverage.interviewId, input.interviewId),
            eq(interviewCoverage.category, input.category),
            eq(interviewCoverage.topic, "__category__"),
          ))
          .limit(1);
        if (!coverage || coverage.count >= 3) throw new Error("CATEGORY_LIMIT_REACHED");
        const [indexRow] = await tx.select({ next: sql<number>`coalesce(max(${interviewQuestions.questionIndex}), 0) + 1` })
          .from(interviewQuestions)
          .where(eq(interviewQuestions.interviewId, input.interviewId));
        const [question] = await tx.insert(interviewQuestions).values({
          interviewId: input.interviewId,
          questionIndex: Number(indexRow.next),
          questionType: input.category,
          topic: input.topic,
          question: input.question,
          tip: "",
        }).returning({ id: interviewQuestions.id });
        const [sequenceRow] = await tx.select({
          sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1`,
        }).from(interviewMessages).where(eq(interviewMessages.interviewId, input.interviewId));
        const [message] = await tx.insert(interviewMessages).values({
          ...(input.provisionalMessageId ? { id: input.provisionalMessageId } : {}),
          interviewId: input.interviewId,
          runId: input.runId,
          sequence: Number(sequenceRow.sequence),
          role: "assistant",
          kind: "question",
          content: input.responseText,
          questionId: question.id,
        }).returning({ id: interviewMessages.id, sequence: interviewMessages.sequence });
        const updatedCoverage = await tx.update(interviewCoverage).set({
          questionCount: sql`${interviewCoverage.questionCount} + 1`,
          resumeEvidenceIds: input.resumeEvidenceIds,
          status: "partial",
          updatedAt: new Date(),
        }).where(and(
          eq(interviewCoverage.interviewId, input.interviewId),
          eq(interviewCoverage.category, input.category),
          eq(interviewCoverage.topic, "__category__"),
          sql`${interviewCoverage.questionCount} < 3`,
        )).returning({ count: interviewCoverage.questionCount });
        if (updatedCoverage.length === 0) throw new Error("CATEGORY_LIMIT_REACHED");
        const outcome: QuestionOutcome = {
          questionId: question.id,
          messageId: message.id,
          messageSequence: message.sequence,
          responseText: input.responseText,
          committed: true,
        };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "ask_interview_question",
          resultJson: outcome,
        });
        return outcome;
      });
    },
    async commitCoverageUpdate(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);
        const [leasedRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(input.runId, input.lease))
          .limit(1);
        if (!leasedRun) throw new Error("Agent run lease is stale");
        const [existing] = await tx.select({ result: interviewAgentToolCommits.resultJson })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) return existing.result as { updated: true };
        const [interview] = await tx.select({ status: interviews.status })
          .from(interviews)
          .where(eq(interviews.id, input.interviewId))
          .limit(1);
        if (interview?.status !== "active") throw new Error("INTERVIEW_NOT_ACTIVE");
        await tx.insert(interviewCoverage).values({
          interviewId: input.interviewId,
          category: input.category,
          topic: input.topic,
          status: input.status,
          resumeEvidenceIds: input.resumeEvidenceIds,
        }).onConflictDoUpdate({
          target: [
            interviewCoverage.interviewId,
            interviewCoverage.category,
            interviewCoverage.topic,
          ],
          set: {
            status: input.status,
            resumeEvidenceIds: input.resumeEvidenceIds,
            updatedAt: new Date(),
          },
        });
        const result = { updated: true as const };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "update_coverage",
          resultJson: result,
        });
        return result;
      });
    },
    async commitFinishOutcome(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);
        const [leasedRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(input.runId, input.lease))
          .limit(1);
        if (!leasedRun) throw new Error("Agent run lease is stale");
        const [existing] = await tx.select({ result: interviewAgentToolCommits.resultJson })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) return existing.result as FinishOutcome;
        const changed = await tx.update(interviews).set({
          status: "scoring",
          updatedAt: new Date(),
        }).where(and(
          eq(interviews.id, input.interviewId),
          eq(interviews.status, "active"),
        )).returning({ id: interviews.id });
        if (changed.length === 0) throw new Error("INTERVIEW_NOT_ACTIVE");
        await tx.insert(interviewCompletionJobs).values({
          interviewId: input.interviewId,
        }).onConflictDoNothing({ target: interviewCompletionJobs.interviewId });
        const [sequenceRow] = await tx.select({
          sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1`,
        }).from(interviewMessages).where(eq(interviewMessages.interviewId, input.interviewId));
        const [message] = await tx.insert(interviewMessages).values({
          interviewId: input.interviewId,
          runId: input.runId,
          sequence: Number(sequenceRow.sequence),
          role: "assistant",
          kind: "finish",
          content: input.closingMessage,
        }).returning({ id: interviewMessages.id, sequence: interviewMessages.sequence });
        const outcome: FinishOutcome = {
          messageId: message.id,
          messageSequence: message.sequence,
          responseText: input.closingMessage,
          committed: true,
        };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "finish_interview",
          resultJson: outcome,
        });
        return outcome;
      });
    },
    async markInterviewCompleting(interviewId) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${interviewId}))`);
        const changed = await tx.update(interviews).set({
          status: "completing",
          updatedAt: new Date(),
        }).where(and(eq(interviews.id, interviewId), eq(interviews.status, "active")))
          .returning({ id: interviews.id });
        if (changed.length === 0) return { changed: false, invalidatedRunIds: [] };
        await tx.insert(interviewCompletionJobs).values({ interviewId })
          .onConflictDoNothing({ target: interviewCompletionJobs.interviewId });
        const activeRuns = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns).where(and(
          eq(interviewAgentRuns.interviewId, interviewId),
          eq(interviewAgentRuns.status, "running"),
        ));
        const invalidatedRunIds: string[] = [];
        for (const run of activeRuns) {
          const [invalidated] = await tx.update(interviewAgentRuns).set({
            status: "failed",
            exitReason: "aborted_tools",
            errorJson: sanitizeAIError(new Error("Interview ended by user")),
            lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(
            eq(interviewAgentRuns.id, run.id),
            eq(interviewAgentRuns.status, "running"),
          )).returning({ sequence: interviewAgentRuns.lastEventSequence });
          if (!invalidated) continue;
          await tx.insert(interviewAgentEvents).values({
            runId: run.id,
            sequence: invalidated.sequence,
            dedupeKey: "terminal",
            type: "run_failed",
            payload: buildTerminalPayload(run.id, {
              exitReason: "aborted_tools",
              userMessage: "用户已结束面试。",
            }),
          });
          invalidatedRunIds.push(run.id);
        }
        return { changed: true, invalidatedRunIds };
      });
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
  leaseGeneration: number;
  resumeCount: number;
  nextResumeAt: Date | null;
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

function runFenceCondition(runId: string, lease?: RunLeaseToken) {
  return and(
    eq(interviewAgentRuns.id, runId),
    eq(interviewAgentRuns.status, "running"),
    ...(lease ? [
      eq(interviewAgentRuns.leaseOwner, lease.owner),
      eq(interviewAgentRuns.leaseGeneration, lease.generation),
    ] : []),
  );
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
    userMessage: input.userMessage ?? agentExitMessage(input.exitReason),
  });
}
