import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import {
  agentRuns,
  agentSessions,
  agentEvents,
  interviewAgentRuns,
  interviewAnswers,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import type { CreateInterviewRequest, ResumeEvidenceMap } from "../domain/create-interview";

export type InterviewTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type InterviewDatabase = typeof db;

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
    if (logicalRun.status !== "queued") {
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
    const [agentRun] = await transaction.update(agentRuns).set({
      status: "running",
      startedAt: new Date(),
    }).where(and(
      eq(agentRuns.id, logicalRun.currentAgentRunId),
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
      errorJson: null,
    }).where(and(
      eq(interviewAgentRuns.id, logicalRun.id),
      eq(interviewAgentRuns.status, "queued"),
    )).returning();
    if (!claimedRun) throw new Error("Opening run claim was lost");
    await appendAgentEventsInTransaction(transaction, {
      sessionId: session.id,
      runId: agentRun.id,
      events: [{
        type: "model_message",
        payload: { message: input.buildModelMessage({ interview, snapshot }) },
        dedupeKey: `interview:opening-context:${logicalRun.id}`,
        visibility: "model",
      }],
    });
    return {
      state: "claimed" as const,
      interview,
      logicalRun: claimedRun,
      agentRun,
      session: { ...session, status: "running" },
      snapshot,
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
  const [run] = await input.database.select({ status: interviewAgentRuns.status })
    .from(interviewAgentRuns)
    .innerJoin(interviews, eq(interviewAgentRuns.interviewId, interviews.id))
    .where(and(
      eq(interviewAgentRuns.id, input.openingRunId),
      eq(interviews.userId, input.userId),
    ))
    .limit(1);
  return run?.status ?? null;
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

export async function failInterviewOpeningRun(input: {
  database: InterviewDatabase;
  openingRunId: string;
  errorCode: string;
}) {
  await input.database.update(interviewAgentRuns).set({
    status: "failed",
    errorJson: { code: input.errorCode },
    completedAt: new Date(),
  }).where(and(
    eq(interviewAgentRuns.id, input.openingRunId),
    eq(interviewAgentRuns.status, "running"),
  ));
}

export async function claimInterviewTurnRun(input: {
  database: InterviewDatabase;
  userId: string;
  interviewRunId: string;
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
    if (logicalRun.status !== "queued") {
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
    const [agentRun] = await transaction.update(agentRuns).set({
      status: "running",
      startedAt: new Date(),
    }).where(and(
      eq(agentRuns.id, logicalRun.currentAgentRunId),
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
      errorJson: null,
    }).where(and(
      eq(interviewAgentRuns.id, logicalRun.id),
      eq(interviewAgentRuns.status, "queued"),
    )).returning();
    if (!claimedRun) throw new Error("Interview turn claim was lost");
    await appendAgentEventsInTransaction(transaction, {
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
        dedupeKey: `interview:turn-context:${logicalRun.id}`,
        visibility: "model",
      }],
    });
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
  errorCode: string;
}) {
  await input.database.update(interviewAgentRuns).set({
    status: "failed",
    errorJson: { code: input.errorCode },
    completedAt: new Date(),
  }).where(and(
    eq(interviewAgentRuns.id, input.interviewRunId),
    eq(interviewAgentRuns.status, "running"),
  ));
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
    }).from(interviews)
      .innerJoin(agentSessions, and(
        eq(agentSessions.id, interviews.agentSessionId),
        eq(agentSessions.userId, interviews.userId),
        eq(agentSessions.capability, "interview"),
      ))
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

    return {
      interview,
      currentQuestion: questions[0] ?? null,
      currentRun: runs[0] ?? null,
      events,
    };
  }, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
