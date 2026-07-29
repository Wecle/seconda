import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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
  AgentEventRecord,
  AgentEventVisibility,
  AgentExitReason,
  InterviewAgentState,
} from "@/lib/interview/agent/protocols/events";
import {
  questionCategorySchema,
  type CoverageStatus,
  type QuestionCategory,
} from "@/lib/interview/agent/domain/interview";
import {
  authorizeTurnProposal,
  projectAssessmentCoverage,
} from "@/lib/interview/agent/domain/turn-authorizer";
import {
  hashTurnProposalPrefix,
  interviewTurnProposalSchema,
  turnProposalPrefixSchema,
} from "@/lib/interview/agent/domain/turn-proposal";
import {
  buildTerminalPayload,
  parseAuthorizedProposal,
} from "@/lib/interview/agent/persistence/invariants";
import {
  MAX_AGENT_RUN_RESUMES,
  RECOVERABLE_RUN_EXIT_REASONS,
  type AgentRunPhase,
  type AgentRunRecord,
  type AgentRunTrigger,
  type CommittedTurnOutcome,
  type FinishOutcome,
  type InterviewAgentRepository,
  type QuestionOutcome,
  type RunLeaseToken,
} from "@/lib/interview/agent/persistence/repository";

type AgentDatabase = typeof import("@/lib/db").db;
type AgentTransaction = Parameters<Parameters<AgentDatabase["transaction"]>[0]>[0];

async function archivePublicTerminalEvents(
  tx: AgentTransaction,
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

async function notifyAgentEventAppend(
  execute: (query: SQL) => Promise<unknown>,
  runId: string,
  latestSequence: number,
) {
  await execute(sql`SELECT pg_notify(
    'interview_agent_events',
    ${JSON.stringify({ runId, latestSequence })}
  )`);
}

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
        .values({ ...input, streamMode: "durable_provisional" })
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
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
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
        const visibility = event.visibility ?? "internal";
        await tx.insert(interviewAgentEvents).values({
          runId,
          sequence: run.sequence,
          dedupeKey: event.dedupeKey,
          attemptId: event.attemptId ?? null,
          logicalMessageId: event.logicalMessageId ?? null,
          visibility,
          type: event.type,
          payload: event.payload,
        });
        if (visibility === "public") {
          await notifyAgentEventAppend((query) => tx.execute(query), runId, run.sequence);
        }
        return run;
      });
    },
    async getRun(runId) {
      const [run] = await database.select({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
        status: interviewAgentRuns.status,
        phase: interviewAgentRuns.phase,
        attemptId: interviewAgentRuns.attemptId,
        attemptNumber: interviewAgentRuns.attemptNumber,
        provisionalMessageId: interviewAgentRuns.provisionalMessageId,
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
    async listEvents(runId, afterSequence, options) {
      const rows = await database.select({
        id: interviewAgentEvents.id,
        runId: interviewAgentEvents.runId,
        sequence: interviewAgentEvents.sequence,
        type: interviewAgentEvents.type,
        visibility: interviewAgentEvents.visibility,
        attemptId: interviewAgentEvents.attemptId,
        logicalMessageId: interviewAgentEvents.logicalMessageId,
        payload: interviewAgentEvents.payload,
        createdAt: interviewAgentEvents.createdAt,
      }).from(interviewAgentEvents)
        .where(and(
          eq(interviewAgentEvents.runId, runId),
          gt(interviewAgentEvents.sequence, afterSequence),
          options?.visibility
            ? eq(interviewAgentEvents.visibility, options.visibility)
            : undefined,
        ))
        .orderBy(asc(interviewAgentEvents.sequence));
      return rows.map((row) => ({
        ...row,
        type: row.type as AgentEventRecord["type"],
        visibility: row.visibility as AgentEventVisibility,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    async claimRun(runId, owner, now, leaseMs) {
      const expiresAt = new Date(now.getTime() + leaseMs);
      const claimed = await database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
        const [row] = await tx.update(interviewAgentRuns).set({
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
          phase: interviewAgentRuns.phase,
          attemptId: interviewAgentRuns.attemptId,
          attemptNumber: interviewAgentRuns.attemptNumber,
          provisionalMessageId: interviewAgentRuns.provisionalMessageId,
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
        if (row) await archivePublicTerminalEvents(tx, runId);
        return row;
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
        phase: "reasoning",
        authorizedProposalJson: null,
        authorizedProposalHash: null,
        proposalAuthorizedAt: null,
        responseStartedAt: null,
        lastProviderProgressAt: input.now,
        updatedAt: input.now,
      }).where(and(
        runFenceCondition(runId, lease),
        sql`${interviewAgentRuns.attemptNumber} < ${input.attemptNumber}`,
      )).returning({ id: interviewAgentRuns.id });
      if (rows.length > 0) return;
      const [current] = await database.select({
        attemptId: interviewAgentRuns.attemptId,
        attemptNumber: interviewAgentRuns.attemptNumber,
        logicalMessageId: interviewAgentRuns.provisionalMessageId,
      }).from(interviewAgentRuns).where(runFenceCondition(runId, lease)).limit(1);
      if (
        current
        && current.attemptNumber === input.attemptNumber
        && current.attemptId === input.attemptId
        && current.logicalMessageId === input.provisionalMessageId
      ) return;
      throw new Error("Agent attempt is stale");
    },
    async authorizeProposal(input) {
      const proposal = parseAuthorizedProposal(input.proposal, input.proposalHash);
      const authorizedAt = input.authorizedAt ?? new Date();
      const rows = await database.update(interviewAgentRuns).set({
        phase: "authorized",
        authorizedProposalJson: proposal,
        authorizedProposalHash: input.proposalHash,
        proposalAuthorizedAt: authorizedAt,
        responseStartedAt: null,
        checkpointJson: input.checkpoint,
        turnCount: input.checkpoint.turnCount,
        updatedAt: authorizedAt,
      }).where(and(
        runAttemptFenceCondition(input),
        inArray(interviewAgentRuns.phase, [
          "reasoning",
          "tool_running",
          "proposal_streaming",
          "repairing",
        ]),
      )).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent attempt is stale");
      return { authorized: true, proposalHash: input.proposalHash };
    },
    async markResponseStarted(input) {
      const startedAt = input.startedAt ?? new Date();
      const rows = await database.update(interviewAgentRuns).set({
        phase: "responding",
        responseStartedAt: startedAt,
        updatedAt: startedAt,
      }).where(and(
        runAttemptFenceCondition(input),
        eq(interviewAgentRuns.phase, "authorized"),
        eq(interviewAgentRuns.authorizedProposalHash, input.proposalHash),
      )).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent proposal hash is stale or attempt is stale");
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
        ...(checkpoint.phase ? { phase: checkpoint.phase } : {}),
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
        await archivePublicTerminalEvents(tx, runId);
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
            ? sql`CASE
                WHEN ${interviewAgentRuns.resumeCount} >= ${MAX_AGENT_RUN_RESUMES}
                  THEN NULL
                ELSE CURRENT_TIMESTAMP
                  + LEAST(
                      300000,
                      30000 * POWER(2, ${interviewAgentRuns.resumeCount})
                    ) * INTERVAL '1 millisecond'
              END`
            : null,
        }).where(runFenceCondition(runId, lease)).returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!updated) throw new Error("Agent run lease is stale");
        await tx.insert(interviewAgentEvents).values({
          runId,
          sequence: updated.sequence,
          attemptId: null,
          logicalMessageId: null,
          visibility: "public",
          type: completed ? "run_completed" : "run_failed",
          payload: buildTerminalPayload(runId, input),
        });
        await notifyAgentEventAppend((query) => tx.execute(query), runId, updated.sequence);
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
    async commitTurnOutcome(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);

        const [run] = await tx.select({
          interviewId: interviewAgentRuns.interviewId,
          model: interviewAgentRuns.model,
          phase: interviewAgentRuns.phase,
          authorizedProposal: interviewAgentRuns.authorizedProposalJson,
          authorizedProposalHash: interviewAgentRuns.authorizedProposalHash,
          responseStartedAt: interviewAgentRuns.responseStartedAt,
        }).from(interviewAgentRuns)
          .where(runAttemptFenceCondition(input))
          .limit(1);
        if (!run) throw new Error("Agent attempt is stale");
        if (run.interviewId !== input.interviewId) {
          throw new Error("Agent run does not belong to interview");
        }

        const [existing] = await tx.select({
          toolName: interviewAgentToolCommits.toolName,
          result: interviewAgentToolCommits.resultJson,
        })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) {
          if (existing.toolName !== "submit_interview_turn") {
            throw new Error("Agent tool call id is already committed by another tool");
          }
          return existing.result as CommittedTurnOutcome;
        }
        if (
          run.phase !== "committing"
          || !run.responseStartedAt
          || run.authorizedProposalHash !== input.proposalHash
        ) {
          throw new Error("Agent proposal hash is stale or response has not started");
        }
        const terminalProposal = interviewTurnProposalSchema.parse({
          ...input.proposal,
          responseText: input.responseText,
        });
        const { responseText, ...proposalInput } = terminalProposal;
        const proposal = parseAuthorizedProposal(proposalInput, input.proposalHash);
        const storedProposal = turnProposalPrefixSchema.parse(run.authorizedProposal);
        if (hashTurnProposalPrefix(storedProposal) !== input.proposalHash) {
          throw new Error("Agent proposal hash is stale");
        }

        const [interview] = await tx.select({
          candidateRoundCount: interviews.candidateRoundCount,
          status: interviews.status,
          language: interviews.language,
        }).from(interviews)
          .where(eq(interviews.id, input.interviewId))
          .limit(1);
        if (!interview) throw new Error(`Unknown interview: ${input.interviewId}`);
        if (interview.language !== input.language) {
          throw new Error("Interview language does not match authoritative configuration");
        }

        let mode: "opening" | "answer" = "opening";
        let answerCategory: QuestionCategory | null = null;
        let answerQuestionId: string | null = null;
        if (input.answerMessageId) {
          const [answer] = await tx.select({
            runId: interviewMessages.runId,
            role: interviewMessages.role,
            kind: interviewMessages.kind,
            questionId: interviewMessages.questionId,
          }).from(interviewMessages).where(and(
            eq(interviewMessages.id, input.answerMessageId),
            eq(interviewMessages.interviewId, input.interviewId),
            eq(interviewMessages.runId, input.runId),
          )).limit(1);
          if (
            !answer
            || answer.runId !== input.runId
            || answer.role !== "user"
            || answer.kind !== "answer"
            || !answer.questionId
          ) {
            throw new Error("Answer message does not belong to this interview question");
          }
          const [question] = await tx.select({
            id: interviewQuestions.id,
            category: interviewQuestions.questionType,
          }).from(interviewQuestions).where(and(
            eq(interviewQuestions.id, answer.questionId),
            eq(interviewQuestions.interviewId, input.interviewId),
          )).limit(1);
          if (!question) throw new Error("Answer question does not belong to interview");
          mode = "answer";
          answerCategory = questionCategorySchema.parse(question.category);
          answerQuestionId = question.id;
        }

        const [coverage, questions, assessments] = await Promise.all([
          tx.select({
            category: interviewCoverage.category,
            questionCount: interviewCoverage.questionCount,
            status: interviewCoverage.status,
          }).from(interviewCoverage).where(and(
            eq(interviewCoverage.interviewId, input.interviewId),
            eq(interviewCoverage.topic, "__category__"),
          )),
          tx.select({ question: interviewQuestions.question })
            .from(interviewQuestions)
            .where(and(
              eq(interviewQuestions.interviewId, input.interviewId),
              isNotNull(interviewQuestions.askedAt),
            ))
            .orderBy(asc(interviewQuestions.questionIndex)),
          tx.select({ followUpNeeded: interviewAnswerAssessments.followUpNeeded })
            .from(interviewAnswerAssessments)
            .where(eq(interviewAnswerAssessments.interviewId, input.interviewId))
            .orderBy(desc(interviewAnswerAssessments.createdAt))
            .limit(2),
        ]);
        const state: InterviewAgentState = {
          interviewId: input.interviewId,
          candidateRoundCount: interview.candidateRoundCount,
          categoryCounts: Object.fromEntries(
            coverage.map((item) => [item.category, item.questionCount]),
          ),
          categoryStatuses: Object.fromEntries(
            coverage.map((item) => [item.category, item.status]),
          ) as Partial<Record<QuestionCategory, CoverageStatus>>,
          consecutiveNoFollowUpAssessments:
            assessments.findIndex((item) => item.followUpNeeded !== 0) === -1
              ? assessments.length
              : assessments.findIndex((item) => item.followUpNeeded !== 0),
          recentQuestions: questions.slice(-10).map((item) => item.question),
          requestedUserEnd: interview.status === "completing",
        };
        const authorization = authorizeTurnProposal({
          state,
          mode,
          answerCategory,
          prefix: proposal,
          responseText,
        });
        if (!authorization.allowed) {
          throw new Error(`Turn proposal rejected: ${authorization.reason}`);
        }
        if (proposal.decision.action !== "finish" && interview.status !== "active") {
          throw new Error("INTERVIEW_NOT_ACTIVE");
        }

        const now = new Date();
        let assessmentId: string | null = null;
        if (proposal.assessment && input.answerMessageId && answerQuestionId && answerCategory) {
          const [assessment] = await tx.insert(interviewAnswerAssessments).values({
            interviewId: input.interviewId,
            questionId: answerQuestionId,
            answerMessageId: input.answerMessageId,
            completeness: proposal.assessment.completeness,
            specificity: proposal.assessment.specificity,
            evidenceStrength: proposal.assessment.evidenceStrength,
            reflectionDepth: proposal.assessment.reflectionDepth,
            followUpNeeded: proposal.assessment.followUpNeeded ? 1 : 0,
            missingPoints: proposal.assessment.missingPoints,
            extractedEvidence: proposal.assessment.extractedEvidence,
            publicSummary: proposal.assessment.publicSummary,
            model: run.model,
          }).returning({ id: interviewAnswerAssessments.id });
          assessmentId = assessment.id;
          const projected = projectAssessmentCoverage(proposal.assessment);
          await tx.insert(interviewCoverage).values({
            interviewId: input.interviewId,
            category: answerCategory,
            topic: "__category__",
            resumeEvidenceIds: [],
            questionCount: state.categoryCounts[answerCategory] ?? 0,
            depth: projected.depth,
            evidenceQuality: projected.evidenceQuality,
            status: (state.categoryCounts[answerCategory] ?? 0) >= 3
              ? "exhausted"
              : projected.status,
            lastAssessmentId: assessmentId,
          }).onConflictDoUpdate({
            target: [
              interviewCoverage.interviewId,
              interviewCoverage.category,
              interviewCoverage.topic,
            ],
            set: {
              depth: projected.depth,
              evidenceQuality: projected.evidenceQuality,
              status: (state.categoryCounts[answerCategory] ?? 0) >= 3
                ? "exhausted"
                : projected.status,
              lastAssessmentId: assessmentId,
              updatedAt: now,
            },
          });
        }

        for (const change of authorization.prefix.coverageChanges) {
          await tx.insert(interviewCoverage).values({
            interviewId: input.interviewId,
            category: change.category,
            topic: change.topic,
            status: change.status,
            resumeEvidenceIds: change.resumeEvidenceIds,
          }).onConflictDoUpdate({
            target: [
              interviewCoverage.interviewId,
              interviewCoverage.category,
              interviewCoverage.topic,
            ],
            set: {
              status: change.status,
              resumeEvidenceIds: change.resumeEvidenceIds,
              updatedAt: now,
            },
          });
        }

        let questionId: string | null = null;
        let messageKind: CommittedTurnOutcome["message"]["kind"];
        if (proposal.decision.action === "finish") {
          if (interview.status !== "active" && interview.status !== "completing") {
            throw new Error("INTERVIEW_NOT_ACTIVE");
          }
          const changed = await tx.update(interviews).set({
            status: "scoring",
            updatedAt: now,
          }).where(and(
            eq(interviews.id, input.interviewId),
            inArray(interviews.status, ["active", "completing"]),
          )).returning({ id: interviews.id });
          if (changed.length === 0) throw new Error("INTERVIEW_NOT_ACTIVE");
          await tx.insert(interviewCompletionJobs).values({
            interviewId: input.interviewId,
          }).onConflictDoNothing({ target: interviewCompletionJobs.interviewId });
          messageKind = "finish";
        } else {
          const category = proposal.decision.category;
          const [indexRow] = await tx.select({
            next: sql<number>`coalesce(max(${interviewQuestions.questionIndex}), 0) + 1`,
          }).from(interviewQuestions)
            .where(eq(interviewQuestions.interviewId, input.interviewId));
          const [question] = await tx.insert(interviewQuestions).values({
            interviewId: input.interviewId,
            questionIndex: Number(indexRow.next),
            questionType: category,
            topic: proposal.decision.coverageTarget,
            question: responseText,
            tip: "",
          }).returning({ id: interviewQuestions.id });
          questionId = question.id;
          const [categoryCoverage] = await tx.insert(interviewCoverage).values({
            interviewId: input.interviewId,
            category,
            topic: "__category__",
            resumeEvidenceIds: proposal.decision.evidenceIds,
            questionCount: 1,
            status: "partial",
          }).onConflictDoUpdate({
            target: [
              interviewCoverage.interviewId,
              interviewCoverage.category,
              interviewCoverage.topic,
            ],
            set: {
              questionCount: sql`${interviewCoverage.questionCount} + 1`,
              resumeEvidenceIds: proposal.decision.evidenceIds,
              status: sql`CASE WHEN ${interviewCoverage.questionCount} + 1 >= 3 THEN 'exhausted' ELSE 'partial' END`,
              updatedAt: now,
            },
          }).returning({ count: interviewCoverage.questionCount });
          if (categoryCoverage.count > 3) throw new Error("CATEGORY_LIMIT_REACHED");
          messageKind = proposal.decision.action === "clarify"
            ? "clarification"
            : "question";
        }

        const [sequenceRow] = await tx.select({
          sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1`,
        }).from(interviewMessages)
          .where(eq(interviewMessages.interviewId, input.interviewId));
        const messageSequence = Number(sequenceRow.sequence);
        const [createdMessage] = await tx.insert(interviewMessages).values({
          id: input.logicalMessageId,
          interviewId: input.interviewId,
          runId: input.runId,
          sequence: messageSequence,
          role: "assistant",
          kind: messageKind,
          content: responseText,
          questionId,
          metadata: {
            proposalHash: input.proposalHash,
            decision: proposal.decision,
            assessmentId,
          },
        }).returning({ id: interviewMessages.id });
        const message: CommittedTurnOutcome["message"] = {
          id: createdMessage.id,
          runId: input.runId,
          sequence: messageSequence,
          role: "assistant",
          kind: messageKind,
          content: responseText,
        };
        const [updatedRun] = await tx.update(interviewAgentRuns).set({
          phase: "acting",
          lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
          updatedAt: now,
        }).where(runAttemptFenceCondition(input)).returning({
          sequence: interviewAgentRuns.lastEventSequence,
        });
        if (!updatedRun) throw new Error("Agent attempt is stale");
        await tx.insert(interviewAgentEvents).values({
          runId: input.runId,
          sequence: updatedRun.sequence,
          attemptId: input.attemptId,
          logicalMessageId: input.logicalMessageId,
          visibility: "public",
          type: "message_committed",
          payload: {
            runId: input.runId,
            attemptId: input.attemptId,
            logicalMessageId: input.logicalMessageId,
            message,
          },
        });
        const outcome: CommittedTurnOutcome = {
          messageId: message.id,
          messageSequence,
          responseText,
          message,
          committedEventSequence: updatedRun.sequence,
          committed: true,
        };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "submit_interview_turn",
          resultJson: outcome,
        });
        await notifyAgentEventAppend(
          (query) => tx.execute(query),
          input.runId,
          updatedRun.sequence,
        );
        return outcome;
      });
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
        )).orderBy(asc(interviewAgentRuns.id));
        const invalidatedRunIds: string[] = [];
        for (const run of activeRuns) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${run.id}))`);
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
          await archivePublicTerminalEvents(tx, run.id);
          await tx.insert(interviewAgentEvents).values({
            runId: run.id,
            sequence: invalidated.sequence,
            dedupeKey: "terminal",
            attemptId: null,
            logicalMessageId: null,
            visibility: "public",
            type: "run_failed",
            payload: buildTerminalPayload(run.id, {
              exitReason: "aborted_tools",
              userMessage: "用户已结束面试。",
            }),
          });
          await notifyAgentEventAppend((query) => tx.execute(query), run.id, invalidated.sequence);
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
  phase: string;
  attemptId: string | null;
  attemptNumber: number;
  provisionalMessageId: string | null;
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
    phase: row.phase as AgentRunPhase,
    exitReason: row.exitReason as AgentExitReason | null,
    checkpoint: row.checkpoint as AgentCheckpoint | null,
    trigger: row.trigger as AgentRunTrigger | null,
  };
}

function runAttemptFenceCondition(input: {
  runId: string;
  lease: RunLeaseToken;
  attemptId: string;
  logicalMessageId: string;
}) {
  return and(
    runFenceCondition(input.runId, input.lease),
    eq(interviewAgentRuns.attemptId, input.attemptId),
    eq(interviewAgentRuns.provisionalMessageId, input.logicalMessageId),
  );
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
