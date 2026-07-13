import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  interviewAgentEvents,
  interviewAgentRuns,
  interviewCoverage,
  interviewMessages,
  interviewResumeSnapshots,
  interviews,
} from "../lib/db/schema";
import {
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
  return {
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
          eq(interviews.status, "active"),
          interviewScope,
          sql`(
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
          .where(eq(interviewAgentRuns.id, runId))
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
          .innerJoin(
            interviewResumeSnapshots,
            eq(interviewResumeSnapshots.interviewId, interviews.id),
          )
          .where(eq(interviewAgentRuns.id, runId))
          .limit(1);
        if (
          !run
          || run.interviewStatus !== "active"
        ) {
          return "skipped" as const;
        }

        const [assistantMessage] = await tx.select({ id: interviewMessages.id })
          .from(interviewMessages)
          .where(and(
            eq(interviewMessages.runId, runId),
            eq(interviewMessages.role, "assistant"),
          ))
          .limit(1);

        if (assistantMessage) {
          const [terminalEvent] = await tx.select({
            id: interviewAgentEvents.id,
            sequence: interviewAgentEvents.sequence,
            type: interviewAgentEvents.type,
          })
            .from(interviewAgentEvents)
            .where(and(
              eq(interviewAgentEvents.runId, runId),
              inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
            ))
            .limit(1);
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
          return run.status === "running" && leaseAvailable
            ? "resume" as const
            : "skipped" as const;
        }

        const trigger = isAgentRunTrigger(run.trigger)
          ? run.trigger
          : await recoverMissingTrigger(tx, run);
        const discardEvent = await buildDiscardEvent(tx, run);
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
  const [terminalEvent] = await tx.select({
    id: interviewAgentEvents.id,
    type: interviewAgentEvents.type,
  })
    .from(interviewAgentEvents)
    .where(and(
      eq(interviewAgentEvents.runId, run.id),
      inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
    ))
    .limit(1);
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

export async function main() {
  const [{ db }, { createProductionAgentDependencies }, { executeClaimedRun }] =
    await Promise.all([
      import("../lib/db"),
      import("../lib/interview/agent/composition"),
      import("../lib/interview/agent/worker"),
    ]);
  const dependencies = createProductionAgentDependencies();
  const result = await reconcileAgentRuntimeCutover(
    createDrizzleAgentRuntimeCutoverStore(db),
    async (runId) => {
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
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
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
