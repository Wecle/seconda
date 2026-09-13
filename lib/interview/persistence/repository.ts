import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import {
  agentRuns,
  agentSessions,
  agentEvents,
  interviewAgentRuns,
  interviewAnswers,
  interviewCompletionJobs,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import type { CreateInterviewRequest, ResumeEvidenceMap } from "../domain/create-interview";

export type InterviewTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type InterviewDatabase = typeof db;

const INTERVIEW_RUN_LEASE_MS = 30_000;

function leaseExpiry(durationMs = INTERVIEW_RUN_LEASE_MS) {
  return new Date(Date.now() + durationMs);
}

export async function lockInterviewCreationKey(
  transaction: InterviewTransaction,
  userId: string,
  idempotencyKey: string,
) {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${idempotencyKey}`}, 0))
  `);
}

export async function findInterviewCreation(
  transaction: InterviewTransaction,
  userId: string,
  idempotencyKey: string,
) {
  const [row] = await transaction
    .select({
      interviewId: interviews.id,
      agentSessionId: interviews.agentSessionId,
      requestHash: interviews.creationRequestHash,
      status: interviews.status,
      openingRunId: interviewAgentRuns.id,
      agentRunId: interviewAgentRuns.currentAgentRunId,
    })
    .from(interviews)
    .leftJoin(
      interviewAgentRuns,
      and(
        eq(interviewAgentRuns.interviewId, interviews.id),
        eq(interviewAgentRuns.triggerKey, "opening"),
      ),
    )
    .where(and(
      eq(interviews.userId, userId),
      eq(interviews.creationIdempotencyKey, idempotencyKey),
    ))
    .limit(1);
  return row ?? null;
}

export async function loadOwnedResumeVersion(
  transaction: InterviewTransaction,
  userId: string,
  resumeVersionId: string,
) {
  const [row] = await transaction
    .select({
      resumeId: resumes.id,
      resumeTitle: resumes.title,
      resumeVersionId: resumeVersions.id,
      versionNumber: resumeVersions.versionNumber,
      sourceType: resumeVersions.sourceType,
      parsedJson: resumeVersions.parsedJson,
      parseStatus: resumeVersions.parseStatus,
    })
    .from(resumeVersions)
    .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
    .where(and(
      eq(resumeVersions.id, resumeVersionId),
      eq(resumes.userId, userId),
    ))
    .limit(1)
    .for("share");
  return row ?? null;
}

export async function insertInterviewCreation(
  transaction: InterviewTransaction,
  input: {
    userId: string;
    idempotencyKey: string;
    requestHash: string;
    request: CreateInterviewRequest;
    model: string;
    promptVersion: string;
    systemPrompt: string;
    resume: {
      resumeId: string;
      resumeTitle: string;
      resumeVersionId: string;
      versionNumber: number;
      sourceType: "uploaded" | "generated";
      parsedJson: Record<string, unknown>;
      canonicalText: string;
      evidenceJson: ResumeEvidenceMap;
      contentHash: string;
    };
  },
) {
  const [session] = await transaction.insert(agentSessions).values({
    userId: input.userId,
    title: `Interview: ${input.request.targetRole}`.slice(0, 100),
    model: input.model,
    capability: "interview",
    promptVersion: input.promptVersion,
    systemPrompt: input.systemPrompt,
    workspaceRoot: null,
    status: "idle",
  }).returning();
  const [interview] = await transaction.insert(interviews).values({
    userId: input.userId,
    creationIdempotencyKey: input.idempotencyKey,
    creationRequestHash: input.requestHash,
    agentSessionId: session.id,
    resumeVersionId: input.resume.resumeVersionId,
    language: input.request.language,
    persona: input.request.persona,
    interviewType: input.request.interviewType,
    targetLevel: input.request.targetLevel,
    targetRole: input.request.targetRole,
    preference: input.request.preference,
    preferenceTags: input.request.preferenceTags,
    targetRoundCount: input.request.targetRoundCount,
  }).returning();
  await transaction.insert(interviewResumeSnapshots).values({
    interviewId: interview.id,
    resumeId: input.resume.resumeId,
    resumeVersionId: input.resume.resumeVersionId,
    resumeTitle: input.resume.resumeTitle,
    versionNumber: input.resume.versionNumber,
    sourceType: input.resume.sourceType,
    parsedJson: input.resume.parsedJson,
    canonicalText: input.resume.canonicalText,
    evidenceJson: input.resume.evidenceJson,
    contentHash: input.resume.contentHash,
  });
  const [agentRun] = await transaction.insert(agentRuns).values({
    sessionId: session.id,
    status: "queued",
    maxSteps: 3,
  }).returning();
  const [openingRun] = await transaction.insert(interviewAgentRuns).values({
    interviewId: interview.id,
    currentAgentRunId: agentRun.id,
    triggerType: "opening",
    triggerKey: "opening",
    status: "queued",
  }).returning();
  return { interview, session, openingRun, agentRun };
}

export async function claimInterviewOpeningRun(input: {
  database: InterviewDatabase;
  userId: string;
  openingRunId: string;
  leaseOwner: string;
  leaseDurationMs?: number;
  buildModelMessage(input: {
    interview: typeof interviews.$inferSelect;
    snapshot: typeof interviewResumeSnapshots.$inferSelect;
  }): ModelMessage;
}) {
  return input.database.transaction(async (transaction) => {
    const [candidateRun] = await transaction.select().from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, input.openingRunId))
      .limit(1);
    if (!candidateRun || candidateRun.triggerType !== "opening" || !candidateRun.currentAgentRunId) {
      return { state: "not_found" as const };
    }
    const [interview] = await transaction.select().from(interviews)
      .where(and(eq(interviews.id, candidateRun.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");
    if (!interview) return { state: "not_found" as const };
    const [logicalRun] = await transaction.select().from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, input.openingRunId))
      .limit(1)
      .for("update");
    if (!logicalRun || logicalRun.interviewId !== interview.id || !logicalRun.currentAgentRunId) {
      return { state: "not_found" as const };
    }
    const [existingQuestion] = await transaction.select().from(interviewQuestions)
      .where(eq(interviewQuestions.sourceInterviewRunId, logicalRun.id))
      .limit(1);
    if (existingQuestion) return { state: "completed" as const, question: existingQuestion };
    const takingOver = logicalRun.status === "running"
      && (!logicalRun.leaseExpiresAt || logicalRun.leaseExpiresAt <= new Date());
    if (logicalRun.status !== "queued" && !takingOver) {
      return { state: "unavailable" as const, status: logicalRun.status };
    }
    const [session] = await transaction.select().from(agentSessions)
      .where(and(
        eq(agentSessions.id, interview.agentSessionId),
        eq(agentSessions.userId, input.userId),
        eq(agentSessions.capability, "interview"),
      ))
      .limit(1)
      .for("update");
    const [snapshot] = await transaction.select().from(interviewResumeSnapshots)
      .where(eq(interviewResumeSnapshots.interviewId, interview.id))
      .limit(1);
    if (!session || !snapshot) throw new Error("Interview opening context is incomplete");
    let agentRunId = logicalRun.currentAgentRunId;
    if (takingOver) {
      const [currentAttempt] = await transaction.select({
        status: agentRuns.status,
        maxSteps: agentRuns.maxSteps,
      }).from(agentRuns).where(and(
        eq(agentRuns.id, logicalRun.currentAgentRunId),
        eq(agentRuns.sessionId, session.id),
      )).limit(1).for("update");
      if (!currentAttempt) return { state: "unavailable" as const, status: logicalRun.status };
      if (currentAttempt.status === "queued" || currentAttempt.status === "running") {
        await transaction.update(agentRuns).set({
          status: "failed",
          errorMessage: "Interview run lease expired",
          completedAt: new Date(),
        }).where(eq(agentRuns.id, logicalRun.currentAgentRunId));
        await appendAgentEventsInTransaction(transaction, {
          sessionId: session.id,
          runId: logicalRun.currentAgentRunId,
          events: [{
            type: "run_failed",
            payload: { code: "INTERVIEW_RUN_LEASE_EXPIRED" },
            dedupeKey: `interview:lease-expired:${logicalRun.id}:${logicalRun.attemptGeneration}`,
            visibility: "model",
          }],
        });
      }
      const [replacement] = await transaction.insert(agentRuns).values({
        sessionId: session.id,
        status: "queued",
        maxSteps: currentAttempt.maxSteps,
      }).returning({ id: agentRuns.id });
      agentRunId = replacement.id;
    }
    const [agentRun] = await transaction.update(agentRuns).set({
      status: "running",
      startedAt: new Date(),
    }).where(and(
      eq(agentRuns.id, agentRunId),
      eq(agentRuns.sessionId, session.id),
      eq(agentRuns.status, "queued"),
    )).returning();
    if (!agentRun) return { state: "unavailable" as const, status: logicalRun.status };
    await transaction.update(agentSessions).set({ status: "running", updatedAt: new Date() })
      .where(eq(agentSessions.id, session.id));
    const [claimedRun] = await transaction.update(interviewAgentRuns).set({
      status: "running",
      attemptCount: sql`${interviewAgentRuns.attemptCount} + 1`,
      attemptGeneration: sql`${interviewAgentRuns.attemptGeneration} + 1`,
      currentAgentRunId: agentRun.id,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: leaseExpiry(input.leaseDurationMs),
      errorJson: null,
    }).where(and(
      eq(interviewAgentRuns.id, logicalRun.id),
      takingOver
        ? and(
            eq(interviewAgentRuns.status, "running"),
            or(isNull(interviewAgentRuns.leaseExpiresAt), lte(interviewAgentRuns.leaseExpiresAt, new Date())),
          )
        : eq(interviewAgentRuns.status, "queued"),
    )).returning();
    if (!claimedRun) throw new Error("Opening run claim was lost");
    const contextDedupeKey = `interview:opening-context:${logicalRun.id}`;
    let [contextEvent] = await transaction.select({ runId: agentEvents.runId, sequence: agentEvents.sequence }).from(agentEvents).where(and(
      eq(agentEvents.sessionId, session.id),
      eq(agentEvents.dedupeKey, contextDedupeKey),
    )).limit(1);
    if (!contextEvent) {
      [contextEvent] = await appendAgentEventsInTransaction(transaction, {
        sessionId: session.id,
        runId: agentRun.id,
        events: [{
          type: "model_message",
          payload: { message: input.buildModelMessage({ interview, snapshot }) },
          dedupeKey: contextDedupeKey,
          visibility: "model",
        }],
      });
    }
    return {
      state: "claimed" as const,
      interview,
      logicalRun: claimedRun,
      agentRun,
      session: { ...session, status: "running" },
      snapshot,
      skillSnapshotRunId: contextEvent?.runId ?? agentRun.id,
      modelContextBoundarySequence: contextEvent?.sequence,
    };
  });
}

export async function loadOpeningQuestion(input: {
  database: InterviewDatabase;
  userId: string;
  openingRunId: string;
}) {
  const [question] = await input.database.select({
    id: interviewQuestions.id,
    interviewId: interviewQuestions.interviewId,
    sequence: interviewQuestions.sequence,
    kind: interviewQuestions.kind,
    topic: interviewQuestions.topic,
    question: interviewQuestions.question,
    tip: interviewQuestions.tip,
    resumeEvidenceIds: interviewQuestions.resumeEvidenceIds,
  }).from(interviewQuestions)
    .innerJoin(interviews, eq(interviewQuestions.interviewId, interviews.id))
    .where(and(
      eq(interviewQuestions.sourceInterviewRunId, input.openingRunId),
      eq(interviews.userId, input.userId),
    )).limit(1);
  return question ?? null;
}

export async function loadOpeningRunStatus(input: {
  database: InterviewDatabase;
  userId: string;
  openingRunId: string;
}) {
  const [run] = await input.database.select({
    status: interviewAgentRuns.status,
    leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
  })
    .from(interviewAgentRuns)
    .innerJoin(interviews, eq(interviewAgentRuns.interviewId, interviews.id))
    .where(and(
      eq(interviewAgentRuns.id, input.openingRunId),
      eq(interviews.userId, input.userId),
    ))
    .limit(1);
  return run ?? null;
}

export async function loadOwnedOpeningRunReference(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
}) {
  const [row] = await input.database.select({
    openingRunId: interviewAgentRuns.id,
  }).from(interviews)
    .innerJoin(agentSessions, and(
      eq(agentSessions.id, interviews.agentSessionId),
      eq(agentSessions.userId, interviews.userId),
      eq(agentSessions.capability, "interview"),
    ))
    .innerJoin(interviewAgentRuns, and(
      eq(interviewAgentRuns.interviewId, interviews.id),
      eq(interviewAgentRuns.triggerKey, "opening"),
    ))
    .where(and(
      eq(interviews.id, input.interviewId),
      eq(interviews.userId, input.userId),
    ))
    .limit(1);
  return row ?? null;
}

export type SafeInterviewRunFailure = {
  code: "INTERVIEW_TURN_FAILED" | "INTERVIEW_OPENING_FAILED" | "INTERVIEW_RUN_LEASE_EXPIRED" | string;
  stage?:
    | "prepare_context"
    | "compact_context"
    | "model_request"
    | "tool_execution"
    | "domain_commit"
    | "unknown";
  reasonCode?: string;
  retryable?: boolean;
};

async function failInterviewRunAttempt(input: {
  database: InterviewDatabase;
  interviewRunId: string;
  agentRunId: string;
  attemptGeneration: number;
  leaseOwner: string;
  error: string | SafeInterviewRunFailure;
}) {
  const failureObj = typeof input.error === "string" ? { code: input.error } : input.error;
  const errorCode = failureObj.code;
  return input.database.transaction(async (transaction) => {
    const failedAt = new Date();
    const [failed] = await transaction.update(interviewAgentRuns).set({
      status: "failed",
      errorJson: failureObj,
      completedAt: failedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(interviewAgentRuns.id, input.interviewRunId),
      eq(interviewAgentRuns.status, "running"),
      eq(interviewAgentRuns.currentAgentRunId, input.agentRunId),
      eq(interviewAgentRuns.attemptGeneration, input.attemptGeneration),
      eq(interviewAgentRuns.leaseOwner, input.leaseOwner),
      gt(interviewAgentRuns.leaseExpiresAt, new Date()),
    )).returning({ id: interviewAgentRuns.id });
    if (!failed) return false;
    const [attempt] = await transaction.update(agentRuns).set({
      status: "failed",
      errorMessage: errorCode,
      completedAt: failedAt,
    }).where(and(
      eq(agentRuns.id, input.agentRunId),
      eq(agentRuns.status, "running"),
    )).returning({ sessionId: agentRuns.sessionId });
    if (!attempt) throw new Error("Interview Agent attempt could not be failed atomically");
    const [session] = await transaction.update(agentSessions).set({
      status: "failed",
      updatedAt: failedAt,
    }).where(and(
      eq(agentSessions.id, attempt.sessionId),
      eq(agentSessions.status, "running"),
    )).returning({ id: agentSessions.id });
    if (!session) throw new Error("Interview Agent session could not be failed atomically");
    await appendAgentEventsInTransaction(transaction, {
      sessionId: attempt.sessionId,
      runId: input.agentRunId,
      events: [{
        type: "run_failed",
        payload: failureObj,
        dedupeKey: `interview:attempt-failed:${input.interviewRunId}:${input.attemptGeneration}`,
        visibility: "model",
      }],
    });
    return true;
  });
}

export async function failInterviewOpeningRun(input: {
  database: InterviewDatabase;
  openingRunId: string;
  agentRunId: string;
  attemptGeneration: number;
  leaseOwner: string;
  error?: string | SafeInterviewRunFailure;
  errorCode?: string;
}) {
  const error = input.error ?? input.errorCode ?? "INTERVIEW_OPENING_FAILED";
  return failInterviewRunAttempt({ ...input, interviewRunId: input.openingRunId, error });
}

export async function claimInterviewTurnRun(input: {
  database: InterviewDatabase;
  userId: string;
  interviewRunId: string;
  leaseOwner: string;
  leaseDurationMs?: number;
  buildModelMessage(input: {
    interview: typeof interviews.$inferSelect;
    snapshot: typeof interviewResumeSnapshots.$inferSelect;
    answer: typeof interviewAnswers.$inferSelect;
    question: typeof interviewQuestions.$inferSelect;
    history: Array<{
      sequence: number;
      kind: string;
      topic: string;
      question: string;
      answer: string | null;
      answerStatus: string | null;
    }>;
  }): ModelMessage;
}) {
  return input.database.transaction(async (transaction) => {
    const [candidateRun] = await transaction.select().from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, input.interviewRunId))
      .limit(1);
    if (!candidateRun || candidateRun.triggerType === "opening" || !candidateRun.currentAgentRunId || !candidateRun.triggerAnswerId) {
      return { state: "not_found" as const };
    }
    const [interview] = await transaction.select().from(interviews)
      .where(and(eq(interviews.id, candidateRun.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");
    if (!interview) return { state: "not_found" as const };
    const [logicalRun] = await transaction.select().from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, input.interviewRunId))
      .limit(1)
      .for("update");
    if (!logicalRun || logicalRun.interviewId !== interview.id || !logicalRun.currentAgentRunId || !logicalRun.triggerAnswerId) {
      return { state: "not_found" as const };
    }
    if (logicalRun.status === "completed") return { state: "completed" as const };
    const takingOver = logicalRun.status === "running"
      && (!logicalRun.leaseExpiresAt || logicalRun.leaseExpiresAt <= new Date());
    if (logicalRun.status !== "queued" && !takingOver) {
      return { state: "unavailable" as const, status: logicalRun.status };
    }
    const [session] = await transaction.select().from(agentSessions)
      .where(and(
        eq(agentSessions.id, interview.agentSessionId),
        eq(agentSessions.userId, input.userId),
        eq(agentSessions.capability, "interview"),
      ))
      .limit(1)
      .for("update");
    const [snapshot] = await transaction.select().from(interviewResumeSnapshots)
      .where(eq(interviewResumeSnapshots.interviewId, interview.id))
      .limit(1);
    const [trigger] = await transaction.select({
      answer: interviewAnswers,
      question: interviewQuestions,
    }).from(interviewAnswers)
      .innerJoin(interviewQuestions, eq(interviewAnswers.questionId, interviewQuestions.id))
      .where(and(
        eq(interviewAnswers.id, logicalRun.triggerAnswerId),
        eq(interviewAnswers.interviewId, interview.id),
        eq(interviewQuestions.interviewId, interview.id),
      ))
      .limit(1);
    if (!session || !snapshot || !trigger) throw new Error("Interview turn context is incomplete");
    if ((logicalRun.triggerType === "skip") !== (trigger.answer.status === "skipped")) {
      throw new Error("Interview turn trigger does not match its answer");
    }
    const history = await transaction.select({
      sequence: interviewQuestions.sequence,
      kind: interviewQuestions.kind,
      topic: interviewQuestions.topic,
      question: interviewQuestions.question,
      answer: interviewAnswers.content,
      answerStatus: interviewAnswers.status,
    }).from(interviewQuestions)
      .leftJoin(interviewAnswers, eq(interviewAnswers.questionId, interviewQuestions.id))
      .where(eq(interviewQuestions.interviewId, interview.id))
      .orderBy(asc(interviewQuestions.sequence));
    let agentRunId = logicalRun.currentAgentRunId;
    if (takingOver) {
      const [currentAttempt] = await transaction.select({
        status: agentRuns.status,
        maxSteps: agentRuns.maxSteps,
      }).from(agentRuns).where(and(
        eq(agentRuns.id, logicalRun.currentAgentRunId),
        eq(agentRuns.sessionId, session.id),
      )).limit(1).for("update");
      if (!currentAttempt) return { state: "unavailable" as const, status: logicalRun.status };
      if (currentAttempt.status === "queued" || currentAttempt.status === "running") {
        await transaction.update(agentRuns).set({
          status: "failed",
          errorMessage: "Interview run lease expired",
          completedAt: new Date(),
        }).where(eq(agentRuns.id, logicalRun.currentAgentRunId));
        await appendAgentEventsInTransaction(transaction, {
          sessionId: session.id,
          runId: logicalRun.currentAgentRunId,
          events: [{
            type: "run_failed",
            payload: { code: "INTERVIEW_RUN_LEASE_EXPIRED" },
            dedupeKey: `interview:lease-expired:${logicalRun.id}:${logicalRun.attemptGeneration}`,
            visibility: "model",
          }],
        });
      }
      const [replacement] = await transaction.insert(agentRuns).values({
        sessionId: session.id,
        status: "queued",
        maxSteps: currentAttempt.maxSteps,
      }).returning({ id: agentRuns.id });
      agentRunId = replacement.id;
    }
    const [agentRun] = await transaction.update(agentRuns).set({
      status: "running",
      startedAt: new Date(),
    }).where(and(
      eq(agentRuns.id, agentRunId),
      eq(agentRuns.sessionId, session.id),
      eq(agentRuns.status, "queued"),
    )).returning();
    if (!agentRun) return { state: "unavailable" as const, status: logicalRun.status };
    await transaction.update(agentSessions).set({ status: "running", updatedAt: new Date() })
      .where(eq(agentSessions.id, session.id));
    const [claimedRun] = await transaction.update(interviewAgentRuns).set({
      status: "running",
      attemptCount: sql`${interviewAgentRuns.attemptCount} + 1`,
      attemptGeneration: sql`${interviewAgentRuns.attemptGeneration} + 1`,
      currentAgentRunId: agentRun.id,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: leaseExpiry(input.leaseDurationMs),
      errorJson: null,
    }).where(and(
      eq(interviewAgentRuns.id, logicalRun.id),
      takingOver
        ? and(
            eq(interviewAgentRuns.status, "running"),
            or(isNull(interviewAgentRuns.leaseExpiresAt), lte(interviewAgentRuns.leaseExpiresAt, new Date())),
          )
        : eq(interviewAgentRuns.status, "queued"),
    )).returning();
    if (!claimedRun) throw new Error("Interview turn claim was lost");
    const contextDedupeKey = `interview:turn-context:${logicalRun.id}`;
    let [contextEvent] = await transaction.select({ runId: agentEvents.runId, sequence: agentEvents.sequence }).from(agentEvents).where(and(
      eq(agentEvents.sessionId, session.id),
      eq(agentEvents.dedupeKey, contextDedupeKey),
    )).limit(1);
    if (!contextEvent) {
      [contextEvent] = await appendAgentEventsInTransaction(transaction, {
        sessionId: session.id,
        runId: agentRun.id,
        events: [{
          type: "model_message",
          payload: { message: input.buildModelMessage({
            interview,
            snapshot,
            answer: trigger.answer,
            question: trigger.question,
            history,
          }) },
          dedupeKey: contextDedupeKey,
          visibility: "model",
        }],
      });
    }
    return {
      state: "claimed" as const,
      interview,
      logicalRun: claimedRun,
      agentRun,
      session: { ...session, status: "running" },
      snapshot,
      answer: trigger.answer,
      question: trigger.question,
      history,
      skillSnapshotRunId: contextEvent?.runId ?? agentRun.id,
      modelContextBoundarySequence: contextEvent?.sequence,
    };
  });
}

export async function loadInterviewTurnRunStatus(input: {
  database: InterviewDatabase;
  userId: string;
  interviewRunId: string;
}) {
  const [row] = await input.database.select({
    runStatus: interviewAgentRuns.status,
    interviewStatus: interviews.status,
    leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
  }).from(interviewAgentRuns)
    .innerJoin(interviews, eq(interviewAgentRuns.interviewId, interviews.id))
    .where(and(
      eq(interviewAgentRuns.id, input.interviewRunId),
      eq(interviews.userId, input.userId),
    ))
    .limit(1);
  return row ?? null;
}

export async function failInterviewTurnRun(input: {
  database: InterviewDatabase;
  interviewRunId: string;
  agentRunId: string;
  attemptGeneration: number;
  leaseOwner: string;
  error?: string | SafeInterviewRunFailure;
  errorCode?: string;
}) {
  const error = input.error ?? input.errorCode ?? "INTERVIEW_TURN_FAILED";
  return failInterviewRunAttempt({ ...input, error });
}

export async function renewInterviewRunLease(input: {
  database: InterviewDatabase;
  interviewRunId: string;
  agentRunId: string;
  attemptGeneration: number;
  leaseOwner: string;
  leaseDurationMs?: number;
}) {
  const [renewed] = await input.database.update(interviewAgentRuns).set({
    leaseExpiresAt: leaseExpiry(input.leaseDurationMs),
  }).where(and(
    eq(interviewAgentRuns.id, input.interviewRunId),
    eq(interviewAgentRuns.status, "running"),
    eq(interviewAgentRuns.currentAgentRunId, input.agentRunId),
    eq(interviewAgentRuns.attemptGeneration, input.attemptGeneration),
    eq(interviewAgentRuns.leaseOwner, input.leaseOwner),
    gt(interviewAgentRuns.leaseExpiresAt, new Date()),
  )).returning({ id: interviewAgentRuns.id });
  return Boolean(renewed);
}

export async function retryInterviewRun(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
  interviewRunId: string;
}) {
  return input.database.transaction(async (transaction) => {
    const [interview] = await transaction.select().from(interviews).where(and(
      eq(interviews.id, input.interviewId),
      eq(interviews.userId, input.userId),
    )).limit(1).for("update");
    if (!interview) return { state: "not_found" as const };
    const [logicalRun] = await transaction.select().from(interviewAgentRuns).where(and(
      eq(interviewAgentRuns.id, input.interviewRunId),
      eq(interviewAgentRuns.interviewId, interview.id),
    )).limit(1).for("update");
    if (!logicalRun) return { state: "not_found" as const };
    const expectedInterviewStatus = logicalRun.triggerType === "opening" ? "initializing" : "active";
    if (interview.status !== expectedInterviewStatus) {
      return { state: "conflict" as const, status: interview.status };
    }
    const [committedQuestion] = await transaction.select({ id: interviewQuestions.id })
      .from(interviewQuestions)
      .where(eq(interviewQuestions.sourceInterviewRunId, logicalRun.id))
      .limit(1);
    if (committedQuestion) return { state: "conflict" as const, status: "already_committed" };
    if (logicalRun.triggerType !== "opening") {
      if (!logicalRun.triggerAnswerId) return { state: "conflict" as const, status: "missing_trigger" };
      const [triggerAnswer] = await transaction.select({ status: interviewAnswers.status })
        .from(interviewAnswers)
        .where(and(
          eq(interviewAnswers.id, logicalRun.triggerAnswerId),
          eq(interviewAnswers.interviewId, interview.id),
        ))
        .limit(1);
      const expectedAnswerStatus = logicalRun.triggerType === "skip" ? "skipped" : "answered";
      if (!triggerAnswer || triggerAnswer.status !== expectedAnswerStatus) {
        return { state: "conflict" as const, status: "stale_trigger" };
      }
    }
    if (logicalRun.status === "queued" || logicalRun.status === "running") {
      return { state: "ready" as const, run: logicalRun };
    }
    if (logicalRun.status !== "failed") return { state: "conflict" as const, status: logicalRun.status };
    const [previousAgentRun] = logicalRun.currentAgentRunId
      ? await transaction.select({
          id: agentRuns.id,
          status: agentRuns.status,
          maxSteps: agentRuns.maxSteps,
        }).from(agentRuns).where(and(
          eq(agentRuns.id, logicalRun.currentAgentRunId),
          eq(agentRuns.sessionId, interview.agentSessionId),
        )).limit(1).for("update")
      : [];
    if (!previousAgentRun) throw new Error("Failed interview run is missing its Agent attempt");
    if (previousAgentRun.status === "queued" || previousAgentRun.status === "running") {
      await transaction.update(agentRuns).set({
        status: "failed",
        errorMessage: "Interview attempt was closed by a logical run retry",
        completedAt: new Date(),
      }).where(eq(agentRuns.id, previousAgentRun.id));
      await appendAgentEventsInTransaction(transaction, {
        sessionId: interview.agentSessionId,
        runId: previousAgentRun.id,
        events: [{
          type: "run_failed",
          payload: { code: "INTERVIEW_RUN_RETRIED" },
          dedupeKey: `interview:retry-closed-attempt:${logicalRun.id}:${logicalRun.attemptGeneration}`,
          visibility: "model",
        }],
      });
    }
    const [agentRun] = await transaction.insert(agentRuns).values({
      sessionId: interview.agentSessionId,
      status: "queued",
      maxSteps: previousAgentRun.maxSteps,
    }).returning();
    const [run] = await transaction.update(interviewAgentRuns).set({
      currentAgentRunId: agentRun.id,
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      errorJson: null,
      completedAt: null,
    }).where(and(
      eq(interviewAgentRuns.id, logicalRun.id),
      eq(interviewAgentRuns.status, "failed"),
    )).returning();
    if (!run) throw new Error("Interview retry was lost");
    await appendAgentEventsInTransaction(transaction, {
      sessionId: interview.agentSessionId,
      runId: agentRun.id,
      events: [{
        type: "interview/run_retried",
        payload: { interviewId: interview.id, interviewRunId: run.id },
        dedupeKey: `interview:run-retried:${run.id}:${agentRun.id}`,
        visibility: "internal",
      }],
    });
    return { state: "ready" as const, run };
  });
}

export async function loadOwnedInterviewRoomData(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
}) {
  return input.database.transaction(async (transaction) => {
    const [interview] = await transaction.select({
      id: interviews.id,
      agentSessionId: interviews.agentSessionId,
      status: interviews.status,
      answeredRoundCount: interviews.answeredRoundCount,
      targetRoundCount: interviews.targetRoundCount,
      resumeTitle: interviewResumeSnapshots.resumeTitle,
    }).from(interviews)
      .innerJoin(agentSessions, and(
        eq(agentSessions.id, interviews.agentSessionId),
        eq(agentSessions.userId, interviews.userId),
        eq(agentSessions.capability, "interview"),
      ))
      .leftJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
      .where(and(
        eq(interviews.id, input.interviewId),
        eq(interviews.userId, input.userId),
      )).limit(1);
    if (!interview) return null;

    const questions = await transaction.select({
      id: interviewQuestions.id,
      sequence: interviewQuestions.sequence,
      kind: interviewQuestions.kind,
      topic: interviewQuestions.topic,
      question: interviewQuestions.question,
      tip: interviewQuestions.tip,
      status: interviewQuestions.status,
      resumeEvidenceIds: interviewQuestions.resumeEvidenceIds,
    }).from(interviewQuestions).where(and(
      eq(interviewQuestions.interviewId, interview.id),
      eq(interviewQuestions.status, "awaiting_answer"),
    )).limit(1);
    const runs = await transaction.select({
      id: interviewAgentRuns.id,
      triggerType: interviewAgentRuns.triggerType,
      status: interviewAgentRuns.status,
      agentRunStatus: agentRuns.status,
    }).from(interviewAgentRuns)
      .leftJoin(agentRuns, eq(agentRuns.id, interviewAgentRuns.currentAgentRunId))
      .where(eq(interviewAgentRuns.interviewId, interview.id))
      .orderBy(desc(interviewAgentRuns.createdAt), desc(interviewAgentRuns.id))
      .limit(1);
    const events = await transaction.select({
      runId: agentEvents.runId,
      sequence: agentEvents.sequence,
      type: agentEvents.type,
      payload: agentEvents.payload,
      schemaVersion: agentEvents.schemaVersion,
      visibility: agentEvents.visibility,
    }).from(agentEvents).where(and(
      eq(agentEvents.sessionId, interview.agentSessionId),
      or(
        inArray(agentEvents.visibility, ["user", "model_and_user"]),
        and(
          inArray(agentEvents.type, ["step_started", "assistant_chunk", "skill_loaded", "skill_load_failed"]),
          eq(agentEvents.visibility, "model"),
          eq(agentEvents.schemaVersion, 1),
        ),
      ),
    )).orderBy(asc(agentEvents.sequence));
    const completionJobs = await transaction.select({
      id: interviewCompletionJobs.id,
      status: interviewCompletionJobs.status,
    }).from(interviewCompletionJobs).where(eq(interviewCompletionJobs.interviewId, interview.id)).limit(1);
    const [cursorRow] = await transaction.select({
      cursor: sql<number>`coalesce(max(${agentEvents.sequence}), 0)::int`,
    }).from(agentEvents).where(eq(agentEvents.sessionId, interview.agentSessionId));

    return {
      interview,
      currentQuestion: questions[0] ?? null,
      currentRun: runs[0] ?? null,
      completionJob: completionJobs[0] ?? null,
      events,
      eventCursor: cursorRow?.cursor ?? 0,
    };
  }, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

export async function loadInterviewResumeEvidence(input: {
  database: InterviewDatabase;
  userId: string;
  sessionId: string;
  interviewId: string;
  query?: string;
  evidenceIds?: string[];
  limit?: number;
}) {
  const [row] = await input.database.select({
    evidenceJson: interviewResumeSnapshots.evidenceJson,
  }).from(interviewResumeSnapshots)
    .innerJoin(interviews, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .innerJoin(agentSessions, and(
      eq(agentSessions.id, interviews.agentSessionId),
      eq(agentSessions.userId, interviews.userId),
      eq(agentSessions.capability, "interview"),
    ))
    .where(and(
      eq(interviews.id, input.interviewId),
      eq(interviews.userId, input.userId),
      eq(interviews.agentSessionId, input.sessionId),
    ))
    .limit(1);

  if (!row) {
    throw new Error("Interview resume snapshot is unauthorized or not found");
  }

  const evidenceMap = (row.evidenceJson ?? {}) as ResumeEvidenceMap;
  const maxResults = Math.min(Math.max(1, input.limit ?? 5), 10);
  const results: Array<{ id: string; path: string; text: string }> = [];

  if (input.evidenceIds && input.evidenceIds.length > 0) {
    const requestedSet = new Set(input.evidenceIds);
    for (const [id, entry] of Object.entries(evidenceMap)) {
      if (requestedSet.has(id)) {
        results.push({
          id,
          path: entry.path.slice(0, 200),
          text: entry.text.slice(0, 1_000),
        });
        if (results.length >= maxResults) break;
      }
    }
  }

  if (input.query && results.length < maxResults) {
    const normalizedQuery = input.query.normalize("NFKC").toLowerCase().trim();
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const existingIds = new Set(results.map((r) => r.id));

    const scored: Array<{ id: string; path: string; text: string; score: number }> = [];
    for (const [id, entry] of Object.entries(evidenceMap)) {
      if (existingIds.has(id)) continue;
      const normalizedPath = entry.path.normalize("NFKC").toLowerCase();
      const normalizedText = entry.text.normalize("NFKC").toLowerCase();
      let score = 0;
      if (normalizedText.includes(normalizedQuery) || normalizedPath.includes(normalizedQuery)) {
        score += 10;
      }
      for (const token of queryTokens) {
        if (normalizedText.includes(token)) score += 2;
        if (normalizedPath.includes(token)) score += 3;
      }
      if (score > 0) {
        scored.push({
          id,
          path: entry.path.slice(0, 200),
          text: entry.text.slice(0, 1_000),
          score,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    for (const item of scored) {
      results.push({ id: item.id, path: item.path, text: item.text });
      if (results.length >= maxResults) break;
    }
  }

  return {
    status: "success" as const,
    count: results.length,
    evidence: results,
  };
}

export async function loadInterviewHistoryEntries(input: {
  database: InterviewDatabase;
  userId: string;
  sessionId: string;
  interviewId: string;
  currentInterviewRunId?: string;
  query?: string;
  topic?: string;
  limit?: number;
}) {
  const [interview] = await input.database.select({
    id: interviews.id,
  }).from(interviews)
    .innerJoin(agentSessions, and(
      eq(agentSessions.id, interviews.agentSessionId),
      eq(agentSessions.userId, interviews.userId),
      eq(agentSessions.capability, "interview"),
    ))
    .where(and(
      eq(interviews.id, input.interviewId),
      eq(interviews.userId, input.userId),
      eq(interviews.agentSessionId, input.sessionId),
    ))
    .limit(1);

  if (!interview) {
    throw new Error("Interview history is unauthorized or not found");
  }

  let maxSequenceFilter: number | undefined;
  if (input.currentInterviewRunId) {
    const [currentRun] = await input.database.select({
      triggerAnswerId: interviewAgentRuns.triggerAnswerId,
    }).from(interviewAgentRuns)
      .where(and(
        eq(interviewAgentRuns.id, input.currentInterviewRunId),
        eq(interviewAgentRuns.interviewId, input.interviewId),
      ))
      .limit(1);

    if (currentRun?.triggerAnswerId) {
      const [triggerAnswer] = await input.database.select({
        questionId: interviewAnswers.questionId,
      }).from(interviewAnswers)
        .where(eq(interviewAnswers.id, currentRun.triggerAnswerId))
        .limit(1);

      if (triggerAnswer?.questionId) {
        const [triggerQuestion] = await input.database.select({
          sequence: interviewQuestions.sequence,
        }).from(interviewQuestions)
          .where(eq(interviewQuestions.id, triggerAnswer.questionId))
          .limit(1);

        if (triggerQuestion) {
          maxSequenceFilter = triggerQuestion.sequence - 1;
        }
      }
    }
  }

  const conditions = [
    eq(interviewQuestions.interviewId, input.interviewId),
    inArray(interviewQuestions.status, ["answered", "skipped"]),
  ];
  if (typeof maxSequenceFilter === "number") {
    conditions.push(lte(interviewQuestions.sequence, maxSequenceFilter));
  }

  const rows = await input.database.select({
    sequence: interviewQuestions.sequence,
    kind: interviewQuestions.kind,
    topic: interviewQuestions.topic,
    question: interviewQuestions.question,
    answer: interviewAnswers.content,
    answerStatus: interviewAnswers.status,
  }).from(interviewQuestions)
    .leftJoin(interviewAnswers, eq(interviewAnswers.questionId, interviewQuestions.id))
    .where(and(...conditions))
    .orderBy(asc(interviewQuestions.sequence));

  const maxResults = Math.min(Math.max(1, input.limit ?? 5), 10);
  let filtered = rows.map((r) => ({
    sequence: r.sequence,
    kind: r.kind as "main" | "follow_up",
    topic: r.topic.slice(0, 100),
    question: r.question.slice(0, 1_000),
    answer: r.answerStatus === "answered" && r.answer ? r.answer.slice(0, 2_000) : null,
    skipped: r.answerStatus === "skipped",
  }));

  if (input.topic) {
    const targetTopic = input.topic.normalize("NFKC").toLowerCase().trim();
    filtered = filtered.filter((item) => item.topic.normalize("NFKC").toLowerCase().includes(targetTopic));
  }

  if (input.query) {
    const normalizedQuery = input.query.normalize("NFKC").toLowerCase().trim();
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const scored = filtered.map((item) => {
      const qText = item.question.normalize("NFKC").toLowerCase();
      const aText = (item.answer ?? "").normalize("NFKC").toLowerCase();
      let score = 0;
      if (qText.includes(normalizedQuery) || aText.includes(normalizedQuery)) score += 10;
      for (const token of queryTokens) {
        if (qText.includes(token)) score += 2;
        if (aText.includes(token)) score += 2;
      }
      return { item, score };
    }).filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.item.sequence - a.item.sequence);

    filtered = scored.map((s) => s.item);
  } else if (!input.topic) {
    filtered = filtered.slice(-maxResults);
  }

  const results = filtered.slice(0, maxResults);

  return {
    status: "success" as const,
    count: results.length,
    history: results,
  };
}

export async function claimNextAvailableInterviewRun(input: {
  database: InterviewDatabase;
}): Promise<{
  found: boolean;
  run?: {
    id: string;
    interviewId: string;
    userId: string;
    triggerType: "opening" | "answer" | "skip";
  };
}> {
  return input.database.transaction(async (tx) => {
    const now = new Date();
    const candidateRuns = await tx
      .select({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
        triggerType: interviewAgentRuns.triggerType,
        status: interviewAgentRuns.status,
        userId: interviews.userId,
      })
      .from(interviewAgentRuns)
      .innerJoin(interviews, eq(interviews.id, interviewAgentRuns.interviewId))
      .where(
        or(
          eq(interviewAgentRuns.status, "queued"),
          and(
            eq(interviewAgentRuns.status, "running"),
            isNotNull(interviewAgentRuns.leaseExpiresAt),
            lt(interviewAgentRuns.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(interviewAgentRuns.createdAt), asc(interviewAgentRuns.id))
      .limit(1)
      .for("update", { skipLocked: true });

    const candidate = candidateRuns[0];
    if (!candidate) {
      return { found: false };
    }

    return {
      found: true,
      run: {
        id: candidate.id,
        interviewId: candidate.interviewId,
        userId: candidate.userId,
        triggerType: candidate.triggerType as "opening" | "answer" | "skip",
      },
    };
  });
}
