import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRuns,
  agentSessions,
  interviewAgentRuns,
  interviewResumeSnapshots,
  interviews,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import type { CreateInterviewRequest, ResumeEvidenceMap } from "../domain/create-interview";

export type InterviewTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
