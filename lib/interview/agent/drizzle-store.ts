import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  interviewCoverage,
  interviewAgentRuns,
  interviewMessages,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import { createResumeSnapshotPayload } from "@/lib/interview/resume-snapshot";
import { questionCategorySchema } from "./contracts";
import type { AgentInterviewStore } from "./service";
import { indexResumeEvidence } from "./context/resume-evidence";

type AgentDatabase = typeof import("@/lib/db").db;

export function createDrizzleAgentInterviewStore(
  database: AgentDatabase,
): AgentInterviewStore {
  return {
    async createInterview(input) {
      return database.transaction(async (tx) => {
        const loadExisting = async () => (await tx.select({
          id: interviews.id,
          ownerUserId: interviewResumeSnapshots.ownerUserId,
          resumeVersionId: interviews.resumeVersionId,
          language: interviews.language,
          persona: interviews.persona,
          preference: interviews.preference,
          preferenceTags: interviews.preferenceTags,
          parsedJson: interviewResumeSnapshots.parsedJson,
          extractedText: interviewResumeSnapshots.extractedText,
        }).from(interviews)
          .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
          .where(and(
            eq(interviews.creationOwnerUserId, input.ownerUserId),
            eq(interviews.creationIdempotencyKey, input.idempotencyKey),
          ))
          .limit(1))[0];
        const existing = await loadExisting();
        if (existing) {
          assertSameCreationRequest(existing, input);
          return {
            interviewId: existing.id,
            resumeSummary: buildResumeSummary(existing.parsedJson, existing.extractedText),
          };
        }

        const [provenance] = await tx.select({ resumeId: resumeVersions.resumeId })
          .from(resumeVersions)
          .where(eq(resumeVersions.id, input.resumeVersionId))
          .limit(1);
        if (!provenance) throw new Error("Resume version not found");
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`resume:${provenance.resumeId}`}))`);

        const [source] = await tx.select({
          ownerUserId: resumes.userId,
          resumeTitle: resumes.title,
          versionNumber: resumeVersions.versionNumber,
          originalFilename: resumeVersions.originalFilename,
          storedPath: resumeVersions.storedPath,
          mimeType: resumeVersions.mimeType,
          fileSize: resumeVersions.fileSize,
          extractedText: resumeVersions.extractedText,
          parsedJson: resumeVersions.parsedJson,
          parseStatus: resumeVersions.parseStatus,
        }).from(resumeVersions)
          .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
          .where(eq(resumeVersions.id, input.resumeVersionId))
          .limit(1);
        if (!source) throw new Error("Resume version not found");
        if (source.ownerUserId !== input.ownerUserId) throw new Error("Resume version not found");
        const snapshot = createResumeSnapshotPayload(source);

        const inserted = await tx.insert(interviews).values({
          creationIdempotencyKey: input.idempotencyKey,
          creationOwnerUserId: input.ownerUserId,
          resumeVersionId: input.resumeVersionId,
          level: "agent",
          type: "agent",
          language: input.config.language,
          questionCount: 20,
          persona: input.config.persona,
          configVersion: 2,
          preference: input.config.preference,
          preferenceTags: input.config.preferenceTags,
          status: "active",
        }).onConflictDoNothing()
          .returning({ id: interviews.id });
        if (inserted[0]) {
          await tx.insert(interviewResumeSnapshots).values({ interviewId: inserted[0].id, ...snapshot });
          return {
            interviewId: inserted[0].id,
            resumeSummary: buildResumeSummary(snapshot.parsedJson, snapshot.extractedText),
          };
        }
        const winner = await loadExisting();
        if (!winner) throw new Error("Idempotent interview snapshot creation could not be resolved");
        assertSameCreationRequest(winner, input);
        return {
          interviewId: winner.id,
          resumeSummary: buildResumeSummary(winner.parsedJson, winner.extractedText),
        };
      });
    },
    async initializeCoverage(interviewId) {
      await database.insert(interviewCoverage).values(
        questionCategorySchema.options.map((category) => ({
          interviewId,
          category,
          topic: "__category__",
          resumeEvidenceIds: [],
          status: "uncovered",
        })),
      ).onConflictDoNothing();
    },
    async loadInterview(interviewId) {
      const [interview] = await database.select({
        id: interviews.id,
        status: interviews.status,
        configVersion: interviews.configVersion,
        candidateRoundCount: interviews.candidateRoundCount,
      }).from(interviews).where(eq(interviews.id, interviewId)).limit(1);
      return interview ?? null;
    },
    async acceptCandidateMessage(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        const [existing] = await tx.select({ id: interviewMessages.id, runId: interviewMessages.runId, sequence: interviewMessages.sequence, content: interviewMessages.content })
          .from(interviewMessages)
          .where(and(
            eq(interviewMessages.interviewId, input.interviewId),
            eq(interviewMessages.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        if (existing) {
          if (!existing.runId) throw new Error("Accepted answer is missing its Agent run");
          return { ...existing, runId: existing.runId, created: false };
        }

        const [sequenceRow] = await tx.select({
          sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1`,
        }).from(interviewMessages).where(eq(interviewMessages.interviewId, input.interviewId));
        const updated = await tx.update(interviews).set({
          candidateRoundCount: sql`${interviews.candidateRoundCount} + 1`,
          updatedAt: new Date(),
        }).where(and(
          eq(interviews.id, input.interviewId),
          eq(interviews.status, "active"),
          sql`${interviews.candidateRoundCount} < 20`,
        )).returning({ id: interviews.id });
        if (updated.length === 0) throw new Error("Interview round limit reached");

        const [question] = await tx.select({ id: interviewQuestions.id })
          .from(interviewQuestions)
          .where(and(
            eq(interviewQuestions.interviewId, input.interviewId),
            isNull(interviewQuestions.answeredAt),
          ))
          .orderBy(desc(interviewQuestions.questionIndex))
          .limit(1);
        if (!question) throw new Error("No unanswered interview question exists");

        const [createdRun] = await tx.insert(interviewAgentRuns).values({
          interviewId: input.interviewId,
          idempotencyKey: input.runIdempotencyKey,
          streamMode: "durable_provisional",
          triggerJson: input.trigger,
        }).onConflictDoNothing({
          target: [interviewAgentRuns.interviewId, interviewAgentRuns.idempotencyKey],
        }).returning({ id: interviewAgentRuns.id });
        const runId = createdRun?.id ?? (await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(and(
            eq(interviewAgentRuns.interviewId, input.interviewId),
            eq(interviewAgentRuns.idempotencyKey, input.runIdempotencyKey),
          ))
          .limit(1))[0]?.id;
        if (!runId) throw new Error("Accepted answer Agent run could not be created");

        await tx.update(interviewQuestions).set({
          answerText: input.content,
          answeredAt: new Date(),
        }).where(eq(interviewQuestions.id, question.id));
        const [message] = await tx.insert(interviewMessages).values({
          interviewId: input.interviewId,
          runId,
          sequence: Number(sequenceRow.sequence),
          idempotencyKey: input.idempotencyKey,
          role: "user",
          kind: "answer",
          content: input.content,
          questionId: question.id,
        }).returning({ id: interviewMessages.id, sequence: interviewMessages.sequence, content: interviewMessages.content });
        return { ...message, runId, created: true };
      });
    },
  };
}

function assertSameCreationRequest(
  existing: {
    ownerUserId: string | null;
    resumeVersionId: string | null;
    language: string;
    persona: string;
    preference: string | null;
    preferenceTags: string[] | null;
  },
  input: Parameters<AgentInterviewStore["createInterview"]>[0],
) {
  if (
    existing.ownerUserId !== input.ownerUserId
    || existing.resumeVersionId !== input.resumeVersionId
    || existing.language !== input.config.language
    || existing.persona !== input.config.persona
    || (existing.preference ?? "") !== input.config.preference
    || JSON.stringify(existing.preferenceTags ?? []) !== JSON.stringify(input.config.preferenceTags)
  ) {
    throw new Error("Idempotency key was already used for a different interview request");
  }
}

function buildResumeSummary(parsedJson: unknown, extractedText: string | null) {
  return indexResumeEvidence(parsedJson, extractedText ?? "").overview;
}
