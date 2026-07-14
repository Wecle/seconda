import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  interviewAgentEvents,
  interviewAgentRuns,
  interviewCoverage,
  interviewMessages,
  interviewResumeSnapshots,
  interviews,
} from "../lib/db/schema";
import {
  agentExitReasonSchema,
  attemptDiscardedPayloadSchema,
  questionCategorySchema,
  responseDiscardedPayloadSchema,
  terminalRunPayloadSchema,
} from "../lib/interview/agent/contracts";
import { indexResumeEvidence } from "../lib/interview/agent/context/resume-evidence";
import { agentExitMessage } from "../lib/interview/agent/exit-messages";
import type { AgentRunTrigger } from "../lib/interview/agent/repository";
import {
  ANSWER_RUN_INSTRUCTION,
  buildOpeningInstruction,
} from "../lib/interview/agent/service";

type AgentDatabase = typeof import("../lib/db").db;

export interface AgentRuntimeCutoverStore {
  normalizePublicTerminalEvents(): Promise<void>;
  prepareMissingOpeningRuns(): Promise<string[]>;
  listCandidateRunIds(): Promise<string[]>;
  reconcileRun(
    runId: string,
  ): Promise<"skipped" | "completed" | "resume">;
}

export async function reconcileAgentRuntimeCutover(
  store: AgentRuntimeCutoverStore,
  executeRun: (runId: string) => Promise<void>,
): Promise<{ completed: string[]; resumed: string[] }> {
  const completed: string[] = [];
  const resumed: string[] = [];

  await store.normalizePublicTerminalEvents();

  const openingRunIds = await store.prepareMissingOpeningRuns();
  for (const runId of openingRunIds) {
    resumed.push(runId);
    await executeRun(runId);
  }

  for (const runId of await store.listCandidateRunIds()) {
    const disposition = await store.reconcileRun(runId);
    if (disposition === "completed") completed.push(runId);
    if (disposition === "resume") {
      resumed.push(runId);
      await executeRun(runId);
    }
  }

  return { completed, resumed };
}

export function createDrizzleAgentRuntimeCutoverStore(
  database: AgentDatabase,
  options?: { interviewIds?: string[] },
): AgentRuntimeCutoverStore {
  const interviewScope = options?.interviewIds?.length
    ? inArray(interviews.id, options.interviewIds)
    : undefined;
  const runScope = options?.interviewIds?.length
    ? inArray(interviewAgentRuns.interviewId, options.interviewIds)
    : undefined;
  return {
    async normalizePublicTerminalEvents() {
      const anomalousRuns = await database.select({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
      }).from(interviewAgentRuns)
        .innerJoin(
          interviews,
          eq(interviews.id, interviewAgentRuns.interviewId),
        )
        .where(and(
          interviewScope,
          sql`(
            (
              ${interviewAgentRuns.status} IN ('completed', 'failed')
              AND NOT EXISTS (
                SELECT 1 FROM ${interviewAgentEvents}
                WHERE ${interviewAgentEvents.runId} = ${interviewAgentRuns.id}
                  AND ${interviewAgentEvents.visibility} = 'public'
                  AND ${interviewAgentEvents.type} IN ('run_completed', 'run_failed')
              )
            )
            OR (
              SELECT count(*) FROM ${interviewAgentEvents}
              WHERE ${interviewAgentEvents.runId} = ${interviewAgentRuns.id}
                AND ${interviewAgentEvents.visibility} = 'public'
                AND ${interviewAgentEvents.type} IN ('run_completed', 'run_failed')
            ) > 1
          )`,
        ))
        .orderBy(asc(interviewAgentRuns.createdAt), asc(interviewAgentRuns.id));

      for (const run of anomalousRuns) {
        await database.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${run.interviewId}))`);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${run.id}))`);
          await tx.execute(sql`SELECT id FROM interviews WHERE id = ${run.interviewId} FOR UPDATE`);
          await tx.execute(sql`SELECT id FROM interview_agent_runs WHERE id = ${run.id} FOR UPDATE`);
          const [current] = await tx.select({
            id: interviewAgentRuns.id,
            status: interviewAgentRuns.status,
            exitReason: interviewAgentRuns.exitReason,
            completedAt: interviewAgentRuns.completedAt,
            interviewStatus: interviews.status,
          }).from(interviewAgentRuns)
            .innerJoin(
              interviews,
              eq(interviews.id, interviewAgentRuns.interviewId),
            )
            .where(and(
              eq(interviewAgentRuns.id, run.id),
              eq(interviewAgentRuns.interviewId, run.interviewId),
            ))
            .limit(1);
          if (current) {
            await ensureTerminalRunInvariant(tx, current, {
              clearResumeState: current.interviewStatus !== "active",
            });
          }
        });
      }
    },

    async prepareMissingOpeningRuns() {
      const candidates = await database.select({
        interviewId: interviews.id,
        parsedJson: interviewResumeSnapshots.parsedJson,
        extractedText: interviewResumeSnapshots.extractedText,
      }).from(interviews)
        .innerJoin(
          interviewResumeSnapshots,
          eq(interviewResumeSnapshots.interviewId, interviews.id),
        )
        .where(and(eq(interviews.status, "active"), interviewScope))
        .orderBy(asc(interviews.createdAt), asc(interviews.id));
      const createdRunIds: string[] = [];

      for (const candidate of candidates) {
        const createdRunId = await database.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${candidate.interviewId}))`);
          await tx.execute(sql`SELECT id FROM interviews WHERE id = ${candidate.interviewId} AND status = 'active' FOR UPDATE`);
          const [activeInterview] = await tx.select({ id: interviews.id })
            .from(interviews)
            .where(and(
              eq(interviews.id, candidate.interviewId),
              eq(interviews.status, "active"),
            ))
            .limit(1);
          if (!activeInterview) return null;

          const [existingRun] = await tx.select({ id: interviewAgentRuns.id })
            .from(interviewAgentRuns)
            .where(eq(interviewAgentRuns.interviewId, candidate.interviewId))
            .limit(1);
          if (existingRun) return null;

          await tx.insert(interviewCoverage).values(
            questionCategorySchema.options.map((category) => ({
              interviewId: candidate.interviewId,
              category,
              topic: "__category__",
              resumeEvidenceIds: [],
              status: "uncovered",
            })),
          ).onConflictDoNothing();

          const summary = indexResumeEvidence(
            candidate.parsedJson,
            candidate.extractedText ?? "",
          ).overview;
          const [created] = await tx.insert(interviewAgentRuns).values({
            interviewId: candidate.interviewId,
            idempotencyKey: `cutover:opening:${candidate.interviewId}`,
            streamMode: "durable_provisional",
            triggerJson: {
              mode: "opening",
              instruction: buildOpeningInstruction(summary),
            } satisfies AgentRunTrigger,
          }).onConflictDoNothing({
            target: [
              interviewAgentRuns.interviewId,
              interviewAgentRuns.idempotencyKey,
            ],
          }).returning({ id: interviewAgentRuns.id });
          return created?.id ?? null;
        });
        if (createdRunId) createdRunIds.push(createdRunId);
      }

      return createdRunIds;
    },

    async listCandidateRunIds() {
      const rows = await database.select({ id: interviewAgentRuns.id })
        .from(interviewAgentRuns)
        .innerJoin(interviews, eq(interviews.id, interviewAgentRuns.interviewId))
        .where(and(
          interviewScope,
          sql`(
            (
              ${interviews.status} = 'active'
              AND (
                ${interviewAgentRuns.streamMode} IS DISTINCT FROM 'durable_provisional'
                OR (
                  ${interviewAgentRuns.streamMode} = 'durable_provisional'
                  AND ${interviewAgentRuns.status} = 'running'
                  AND (
                    ${interviewAgentRuns.leaseOwner} IS NULL
                    OR ${interviewAgentRuns.leaseExpiresAt} IS NULL
                    OR ${interviewAgentRuns.leaseExpiresAt} <= NOW()
                  )
                )
              )
            )
            OR (
              ${interviews.status} <> 'active'
              AND ${interviewAgentRuns.status} = 'running'
            )
            OR (
              ${interviewAgentRuns.status} IN ('completed', 'failed')
              AND NOT EXISTS (
                SELECT 1 FROM ${interviewAgentEvents}
                WHERE ${interviewAgentEvents.runId} = ${interviewAgentRuns.id}
                  AND ${interviewAgentEvents.visibility} = 'public'
                  AND ${interviewAgentEvents.type} IN ('run_completed', 'run_failed')
              )
            )
          )`,
        ))
        .orderBy(asc(interviewAgentRuns.createdAt), asc(interviewAgentRuns.id));
      return rows.map((row) => row.id);
    },

    async reconcileRun(runId) {
      return database.transaction(async (tx) => {
        const [identity] = await tx.select({
          interviewId: interviewAgentRuns.interviewId,
        }).from(interviewAgentRuns)
          .where(and(eq(interviewAgentRuns.id, runId), runScope))
          .limit(1);
        if (!identity) return "skipped" as const;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identity.interviewId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
        await tx.execute(sql`SELECT id FROM interviews WHERE id = ${identity.interviewId} FOR UPDATE`);
        const [run] = await tx.select({
          id: interviewAgentRuns.id,
          interviewId: interviewAgentRuns.interviewId,
          interviewStatus: interviews.status,
          status: interviewAgentRuns.status,
          completedAt: interviewAgentRuns.completedAt,
          leaseOwner: interviewAgentRuns.leaseOwner,
          leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
          exitReason: interviewAgentRuns.exitReason,
          streamMode: interviewAgentRuns.streamMode,
          attemptId: interviewAgentRuns.attemptId,
          attemptNumber: interviewAgentRuns.attemptNumber,
          provisionalMessageId: interviewAgentRuns.provisionalMessageId,
          lastEventSequence: interviewAgentRuns.lastEventSequence,
          trigger: interviewAgentRuns.triggerJson,
          parsedJson: interviewResumeSnapshots.parsedJson,
          extractedText: interviewResumeSnapshots.extractedText,
        }).from(interviewAgentRuns)
          .innerJoin(interviews, eq(interviews.id, interviewAgentRuns.interviewId))
          .leftJoin(
            interviewResumeSnapshots,
            eq(interviewResumeSnapshots.interviewId, interviews.id),
          )
          .where(and(eq(interviewAgentRuns.id, runId), runScope))
          .limit(1);
        if (!run) return "skipped" as const;

        const [assistantMessage] = await tx.select({ id: interviewMessages.id })
          .from(interviewMessages)
          .where(and(
            eq(interviewMessages.runId, runId),
            eq(interviewMessages.role, "assistant"),
          ))
          .limit(1);
        const [committedMessageEvent] = await tx.select({ id: interviewAgentEvents.id })
          .from(interviewAgentEvents)
          .where(and(
            eq(interviewAgentEvents.runId, runId),
            eq(interviewAgentEvents.type, "message_committed"),
          ))
          .limit(1);
        const hasCommittedAssistant = Boolean(assistantMessage || committedMessageEvent);

        if (run.interviewStatus !== "active") {
          if (run.status === "running") {
            if (hasCommittedAssistant) {
              await completeCommittedClosedInterviewRun(tx, run);
            } else {
              await retireClosedInterviewRun(tx, run);
            }
          } else if (run.status === "completed" || run.status === "failed") {
            await ensureTerminalRunInvariant(tx, run, {
              clearResumeState: true,
            });
          } else {
            await normalizePublicTerminalEventsForRun(tx, run.id);
          }
          return "skipped" as const;
        }

        if (hasCommittedAssistant) {
          const terminalEvent = await normalizePublicTerminalEventsForRun(tx, runId);
          const appendTerminal = !terminalEvent;
          const [updated] = await tx.update(interviewAgentRuns).set({
            status: "completed",
            phase: "acting",
            exitReason: "completed",
            streamMode: "durable_provisional",
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
            nextResumeAt: null,
            errorJson: null,
            completedAt: new Date(),
            lastEventSequence: appendTerminal
              ? sql`${interviewAgentRuns.lastEventSequence} + 1`
              : interviewAgentRuns.lastEventSequence,
            updatedAt: new Date(),
          }).where(activeCutoverRunFence(runId, run.interviewId))
            .returning({ sequence: interviewAgentRuns.lastEventSequence });
          if (!updated) throw new Error(`Cutover run disappeared: ${runId}`);
          if (appendTerminal) {
            await tx.insert(interviewAgentEvents).values({
              runId,
              sequence: updated.sequence,
              dedupeKey: "cutover:run-completed",
              visibility: "public",
              type: "run_completed",
              payload: terminalRunPayloadSchema.parse({
                runId,
                exitReason: "completed",
                retryable: false,
                userMessage: agentExitMessage("completed"),
              }),
            });
            await notifyPublicEvent(tx, runId, updated.sequence);
          } else if (terminalEvent.type !== "run_completed") {
            await tx.update(interviewAgentEvents).set({
              visibility: "public",
              type: "run_completed",
              attemptId: null,
              logicalMessageId: null,
              payload: terminalRunPayloadSchema.parse({
                runId,
                exitReason: "completed",
                retryable: false,
                userMessage: agentExitMessage("completed"),
              }),
            }).where(eq(interviewAgentEvents.id, terminalEvent.id));
            await notifyPublicEvent(tx, runId, terminalEvent.sequence);
          }
          return "completed" as const;
        }

        if (
          run.streamMode === "durable_provisional"
          && run.status !== "running"
        ) {
          if (run.status === "completed" || run.status === "failed") {
            await ensureTerminalRunInvariant(tx, run, {
              clearResumeState: false,
            });
          }
          return "skipped" as const;
        }

        const [latestRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(eq(interviewAgentRuns.interviewId, run.interviewId))
          .orderBy(
            sql`${interviewAgentRuns.createdAt} DESC`,
            sql`${interviewAgentRuns.id} DESC`,
          )
          .limit(1);
        if (latestRun?.id !== runId) {
          await retireSupersededRun(tx, run);
          return "skipped" as const;
        }

        if (run.streamMode === "durable_provisional") {
          const leaseAvailable = !run.leaseOwner
            || !run.leaseExpiresAt
            || run.leaseExpiresAt.getTime() <= Date.now();
          if (run.status !== "running" || !leaseAvailable) return "skipped" as const;
          await archivePublicTerminalEventsForRun(tx, runId);
          return "resume" as const;
        }

        const trigger = isAgentRunTrigger(run.trigger)
          ? run.trigger
          : await recoverMissingTrigger(tx, run);
        const discardEvent = await buildDiscardEvent(tx, run);
        await archivePublicTerminalEventsForRun(tx, runId);
        const [updated] = await tx.update(interviewAgentRuns).set({
          status: "running",
          phase: "accepted",
          exitReason: null,
          streamMode: "durable_provisional",
          leaseOwner: null,
          leaseExpiresAt: null,
          leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
          attemptId: null,
          attemptNumber: sql`${interviewAgentRuns.attemptNumber} + 1`,
          provisionalMessageId: null,
          lastProviderProgressAt: null,
          checkpointJson: null,
          authorizedProposalJson: null,
          authorizedProposalHash: null,
          proposalAuthorizedAt: null,
          responseStartedAt: null,
          triggerJson: trigger,
          errorJson: null,
          nextResumeAt: null,
          completedAt: null,
          lastEventSequence: discardEvent
            ? sql`${interviewAgentRuns.lastEventSequence} + 1`
            : interviewAgentRuns.lastEventSequence,
          updatedAt: new Date(),
        }).where(activeCutoverRunFence(runId, run.interviewId))
          .returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!updated) throw new Error(`Cutover run disappeared: ${runId}`);
        if (discardEvent) {
          await tx.insert(interviewAgentEvents).values({
            runId,
            sequence: updated.sequence,
            dedupeKey: `cutover:discard:${run.attemptId}`,
            visibility: "public",
            attemptId: run.attemptId,
            logicalMessageId: run.provisionalMessageId,
            type: discardEvent.type,
            payload: discardEvent.payload,
          });
          await notifyPublicEvent(tx, runId, updated.sequence);
        }
        return "resume" as const;
      });
    },
  };
}

type Transaction = Parameters<Parameters<AgentDatabase["transaction"]>[0]>[0];

const CLOSED_INTERVIEW_RUN_MESSAGE = "面试流程已结束，本轮后台处理已终止。";

async function ensureTerminalRunInvariant(
  tx: Transaction,
  run: {
    id: string;
    status: string;
    exitReason: string | null;
    completedAt: Date | null;
  },
  options: { clearResumeState: boolean },
) {
  const terminal = await normalizePublicTerminalEventsForRun(tx, run.id);
  const maximumSequence = await maximumEventSequence(tx, run.id);
  if (run.status !== "completed" && run.status !== "failed") {
    await tx.update(interviewAgentRuns).set({
      lastEventSequence: maximumSequence,
      updatedAt: new Date(),
    }).where(eq(interviewAgentRuns.id, run.id));
    return;
  }

  const parsedExitReason = agentExitReasonSchema.safeParse(run.exitReason);
  const exitReason = run.status === "completed"
    ? "completed" as const
    : parsedExitReason.success && parsedExitReason.data !== "completed"
      ? parsedExitReason.data
      : "aborted_tools" as const;
  const type = run.status === "completed" ? "run_completed" as const : "run_failed" as const;
  const payload = terminalRunPayloadSchema.parse({
    runId: run.id,
    exitReason,
    retryable: exitReason === "aborted_streaming",
    userMessage: agentExitMessage(exitReason),
  });

  if (terminal) {
    await tx.update(interviewAgentEvents).set({
      visibility: "public",
      type,
      attemptId: null,
      logicalMessageId: null,
      payload,
    }).where(eq(interviewAgentEvents.id, terminal.id));
    await tx.update(interviewAgentRuns).set({
      exitReason,
      leaseOwner: null,
      leaseExpiresAt: null,
      ...(options.clearResumeState ? { nextResumeAt: null } : {}),
      completedAt: run.completedAt ?? new Date(),
      lastEventSequence: maximumSequence,
      updatedAt: new Date(),
    }).where(eq(interviewAgentRuns.id, run.id));
    return;
  }

  const sequence = maximumSequence + 1;
  await tx.update(interviewAgentRuns).set({
    exitReason,
    leaseOwner: null,
    leaseExpiresAt: null,
    ...(options.clearResumeState ? { nextResumeAt: null } : {}),
    completedAt: run.completedAt ?? new Date(),
    lastEventSequence: sequence,
    updatedAt: new Date(),
  }).where(eq(interviewAgentRuns.id, run.id));
  await tx.insert(interviewAgentEvents).values({
    runId: run.id,
    sequence,
    visibility: "public",
    type,
    payload,
  });
  await notifyPublicEvent(tx, run.id, sequence);
}

async function retireClosedInterviewRun(
  tx: Transaction,
  run: {
    id: string;
    interviewId: string;
    attemptId: string | null;
    provisionalMessageId: string | null;
  },
) {
  const discardEvent = await buildDiscardEvent(tx, run);
  await archivePublicTerminalEventsForRun(tx, run.id);
  const maximumSequence = await maximumEventSequence(tx, run.id);
  const appendedEvents = [
    ...(discardEvent ? [discardEvent] : []),
    {
      type: "run_failed" as const,
      payload: terminalRunPayloadSchema.parse({
        runId: run.id,
        exitReason: "aborted_tools",
        retryable: false,
        userMessage: CLOSED_INTERVIEW_RUN_MESSAGE,
      }),
    },
  ];
  const finalSequence = maximumSequence + appendedEvents.length;
  const [updated] = await tx.update(interviewAgentRuns).set({
    status: "failed",
    phase: "acting",
    exitReason: "aborted_tools",
    streamMode: "durable_provisional",
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
    attemptId: null,
    provisionalMessageId: null,
    lastProviderProgressAt: null,
    checkpointJson: null,
    authorizedProposalJson: null,
    authorizedProposalHash: null,
    proposalAuthorizedAt: null,
    responseStartedAt: null,
    errorJson: null,
    nextResumeAt: null,
    completedAt: new Date(),
    lastEventSequence: finalSequence,
    updatedAt: new Date(),
  }).where(closedInterviewRunFence(run.id, run.interviewId))
    .returning({ id: interviewAgentRuns.id });
  if (!updated) return;

  for (const [index, event] of appendedEvents.entries()) {
    const sequence = maximumSequence + index + 1;
    const isDiscard = event.type === "attempt_discarded"
      || event.type === "response_discarded";
    await tx.insert(interviewAgentEvents).values({
      runId: run.id,
      sequence,
      visibility: "public",
      attemptId: isDiscard ? run.attemptId : null,
      logicalMessageId: isDiscard ? run.provisionalMessageId : null,
      type: event.type,
      payload: event.payload,
    });
  }
  await notifyPublicEvent(tx, run.id, finalSequence);
}

async function completeCommittedClosedInterviewRun(
  tx: Transaction,
  run: {
    id: string;
    interviewId: string;
  },
) {
  const maximumSequence = await maximumEventSequence(tx, run.id);
  const completedAt = new Date();
  const [updated] = await tx.update(interviewAgentRuns).set({
    status: "completed",
    phase: "acting",
    exitReason: "completed",
    streamMode: "durable_provisional",
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
    attemptId: null,
    provisionalMessageId: null,
    lastProviderProgressAt: null,
    checkpointJson: null,
    authorizedProposalJson: null,
    authorizedProposalHash: null,
    proposalAuthorizedAt: null,
    responseStartedAt: null,
    errorJson: null,
    nextResumeAt: null,
    completedAt,
    lastEventSequence: maximumSequence,
    updatedAt: completedAt,
  }).where(closedInterviewRunFence(run.id, run.interviewId))
    .returning({ id: interviewAgentRuns.id });
  if (!updated) return;
  await ensureTerminalRunInvariant(tx, {
    id: run.id,
    status: "completed",
    exitReason: "completed",
    completedAt,
  }, {
    clearResumeState: true,
  });
}

async function maximumEventSequence(tx: Transaction, runId: string) {
  const [row] = await tx.select({
    value: sql<number>`coalesce(max(${interviewAgentEvents.sequence}), 0)`,
  }).from(interviewAgentEvents)
    .where(eq(interviewAgentEvents.runId, runId));
  return Number(row?.value ?? 0);
}

async function retireSupersededRun(
  tx: Transaction,
  run: {
    id: string;
    interviewId: string;
    attemptId: string | null;
    provisionalMessageId: string | null;
    exitReason: string | null;
  },
) {
  const discardEvent = await buildDiscardEvent(tx, run);
  const terminalEvent = await normalizePublicTerminalEventsForRun(tx, run.id);
  const appendedEvents = [
    ...(discardEvent ? [discardEvent] : []),
    ...(!terminalEvent ? [{
      type: "run_failed" as const,
      payload: terminalRunPayloadSchema.parse({
        runId: run.id,
        exitReason: "aborted_tools",
        retryable: false,
        userMessage: agentExitMessage("aborted_tools"),
      }),
    }] : []),
  ];
  const terminalStatus = terminalEvent?.type === "run_completed"
    ? "completed"
    : "failed";
  const terminalExitReason = terminalEvent?.type === "run_completed"
    ? "completed"
    : terminalEvent ? (run.exitReason ?? "aborted_tools") : "aborted_tools";
  const [updated] = await tx.update(interviewAgentRuns).set({
    status: terminalStatus,
    phase: "acting",
    exitReason: terminalExitReason,
    streamMode: "durable_provisional",
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
    attemptId: null,
    provisionalMessageId: null,
    lastProviderProgressAt: null,
    checkpointJson: null,
    authorizedProposalJson: null,
    authorizedProposalHash: null,
    proposalAuthorizedAt: null,
    responseStartedAt: null,
    errorJson: null,
    nextResumeAt: null,
    completedAt: new Date(),
    lastEventSequence: appendedEvents.length > 0
      ? sql`${interviewAgentRuns.lastEventSequence} + ${appendedEvents.length}`
      : interviewAgentRuns.lastEventSequence,
    updatedAt: new Date(),
  }).where(activeCutoverRunFence(run.id, run.interviewId))
    .returning({ sequence: interviewAgentRuns.lastEventSequence });
  if (!updated) throw new Error(`Cutover run disappeared: ${run.id}`);
  const firstSequence = updated.sequence - appendedEvents.length + 1;
  for (const [index, event] of appendedEvents.entries()) {
    const sequence = firstSequence + index;
    const isDiscard = event.type === "attempt_discarded"
      || event.type === "response_discarded";
    await tx.insert(interviewAgentEvents).values({
      runId: run.id,
      sequence,
      dedupeKey: isDiscard
        ? `cutover:discard:${run.attemptId}`
        : "cutover:superseded",
      visibility: "public",
      attemptId: isDiscard ? run.attemptId : null,
      logicalMessageId: isDiscard ? run.provisionalMessageId : null,
      type: event.type,
      payload: event.payload,
    });
  }
  if (appendedEvents.length > 0) {
    await notifyPublicEvent(tx, run.id, updated.sequence);
  }
}

async function normalizePublicTerminalEventsForRun(
  tx: Transaction,
  runId: string,
) {
  const publicTerminals = await tx.select({
    id: interviewAgentEvents.id,
    sequence: interviewAgentEvents.sequence,
    type: interviewAgentEvents.type,
  })
    .from(interviewAgentEvents)
    .where(and(
      eq(interviewAgentEvents.runId, runId),
      eq(interviewAgentEvents.visibility, "public"),
      inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
    ))
    .orderBy(desc(interviewAgentEvents.sequence));
  const [authoritative, ...superseded] = publicTerminals;
  if (superseded.length > 0) {
    await tx.update(interviewAgentEvents).set({
      visibility: "internal",
    }).where(inArray(
      interviewAgentEvents.id,
      superseded.map((event) => event.id),
    ));
  }
  return authoritative;
}

async function archivePublicTerminalEventsForRun(
  tx: Transaction,
  runId: string,
) {
  await tx.update(interviewAgentEvents).set({
    visibility: "internal",
  }).where(and(
    eq(interviewAgentEvents.runId, runId),
    eq(interviewAgentEvents.visibility, "public"),
    inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
  ));
}

function activeCutoverRunFence(runId: string, interviewId: string) {
  return and(
    eq(interviewAgentRuns.id, runId),
    eq(interviewAgentRuns.interviewId, interviewId),
    sql`EXISTS (
      SELECT 1 FROM ${interviews}
      WHERE ${interviews.id} = ${interviewId}
        AND ${interviews.status} = 'active'
    )`,
  );
}

function closedInterviewRunFence(runId: string, interviewId: string) {
  return and(
    eq(interviewAgentRuns.id, runId),
    eq(interviewAgentRuns.interviewId, interviewId),
    eq(interviewAgentRuns.status, "running"),
    sql`EXISTS (
      SELECT 1 FROM ${interviews}
      WHERE ${interviews.id} = ${interviewId}
        AND ${interviews.status} <> 'active'
    )`,
  );
}

async function recoverMissingTrigger(
  tx: Transaction,
  run: {
    id: string;
    parsedJson: unknown;
    extractedText: string | null;
  },
): Promise<AgentRunTrigger> {
  const [answer] = await tx.select({ id: interviewMessages.id })
    .from(interviewMessages)
    .where(and(
      eq(interviewMessages.runId, run.id),
      eq(interviewMessages.role, "user"),
      eq(interviewMessages.kind, "answer"),
    ))
    .limit(1);
  if (answer) return { mode: "answer", instruction: ANSWER_RUN_INSTRUCTION };
  const summary = indexResumeEvidence(
    run.parsedJson,
    run.extractedText ?? "",
  ).overview;
  return { mode: "opening", instruction: buildOpeningInstruction(summary) };
}

async function buildDiscardEvent(
  tx: Transaction,
  run: {
    id: string;
    attemptId: string | null;
    provisionalMessageId: string | null;
  },
) {
  if (!run.attemptId || !run.provisionalMessageId) return null;
  const attemptEvents = await tx.select({ type: interviewAgentEvents.type })
    .from(interviewAgentEvents)
    .where(and(
      eq(interviewAgentEvents.runId, run.id),
      eq(interviewAgentEvents.attemptId, run.attemptId),
    ));
  if (attemptEvents.some((event) => (
    event.type === "attempt_discarded" || event.type === "response_discarded"
  ))) return null;
  const payload = {
    runId: run.id,
    attemptId: run.attemptId,
    logicalMessageId: run.provisionalMessageId,
    reason: "RUNTIME_CUTOVER",
  };
  if (attemptEvents.some((event) => event.type === "response_started")) {
    return {
      type: "response_discarded" as const,
      payload: responseDiscardedPayloadSchema.parse(payload),
    };
  }
  return {
    type: "attempt_discarded" as const,
    payload: attemptDiscardedPayloadSchema.parse(payload),
  };
}

function isAgentRunTrigger(value: unknown): value is AgentRunTrigger {
  if (typeof value !== "object" || value === null) return false;
  const trigger = value as Record<string, unknown>;
  return (trigger.mode === "opening" || trigger.mode === "answer")
    && typeof trigger.instruction === "string"
    && trigger.instruction.length > 0;
}

async function notifyPublicEvent(
  tx: Transaction,
  runId: string,
  latestSequence: number,
) {
  await tx.execute(sql`SELECT pg_notify(
    'interview_agent_events',
    ${JSON.stringify({ runId, latestSequence })}
  )`);
}

export async function runAgentRuntimeCutoverCommand(input: {
  store: AgentRuntimeCutoverStore;
  executeRun: (runId: string) => Promise<void>;
  drain?: () => Promise<void>;
  close: () => Promise<void>;
  writeOutput?: (line: string) => void;
}) {
  let result: { completed: string[]; resumed: string[] } | undefined;
  const failures: unknown[] = [];
  try {
    try {
      result = await reconcileAgentRuntimeCutover(
        input.store,
        input.executeRun,
      );
    } catch (error) {
      failures.push(error);
    }
    try {
      await input.drain?.();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 0) {
      try {
        (input.writeOutput ?? ((line) => { process.stdout.write(line); }))(
          `${JSON.stringify(result)}\n`,
        );
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    try {
      await input.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Agent runtime cutover failed with cleanup errors",
      { cause: failures[0] },
    );
  }
  return result!;
}

export function createDeferredTaskCollector() {
  const pending = new Set<Promise<void>>();
  return {
    defer(task: () => Promise<void>) {
      const execution = Promise.resolve().then(task);
      pending.add(execution);
      void execution.catch(() => {});
    },
    async drain() {
      const errors: unknown[] = [];
      while (pending.size > 0) {
        const batch = [...pending];
        const results = await Promise.allSettled(batch);
        for (const task of batch) pending.delete(task);
        for (const result of results) {
          if (result.status === "rejected") errors.push(result.reason);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "Deferred cutover tasks failed");
      }
    },
  };
}

export async function main() {
  const [
    { db, closeDatabaseConnection },
    { createProductionAgentDependencies },
    { executeClaimedRun },
  ] =
    await Promise.all([
      import("../lib/db"),
      import("../lib/interview/agent/composition"),
      import("../lib/interview/agent/worker"),
    ]);
  const deferredTasks = createDeferredTaskCollector();
  const dependencies = createProductionAgentDependencies({
    defer: deferredTasks.defer,
  });
  return runAgentRuntimeCutoverCommand({
    store: createDrizzleAgentRuntimeCutoverStore(db),
    executeRun: async (runId) => {
      const execution = await executeClaimedRun({
        runId,
        owner: `cutover:${randomUUID()}`,
        repository: dependencies.repository,
        executor: dependencies.executor,
      });
      if (execution.status === "not_claimed" || execution.status === "lease_lost") {
        throw new Error(`Cutover could not execute run ${runId}: ${execution.status}`);
      }
    },
    drain: deferredTasks.drain,
    close: closeDatabaseConnection,
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
