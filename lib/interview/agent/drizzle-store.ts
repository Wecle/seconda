import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviews,
  resumeVersions,
} from "@/lib/db/schema";
import { questionCategorySchema } from "./contracts";
import type { AgentInterviewStore } from "./service";
import { indexResumeEvidence } from "./context/resume-evidence";

type AgentDatabase = typeof import("@/lib/db").db;

export function createDrizzleAgentInterviewStore(
  database: AgentDatabase,
): AgentInterviewStore {
  return {
    async createInterview(input) {
      const [resume] = await database
        .select({ parsedJson: resumeVersions.parsedJson, extractedText: resumeVersions.extractedText })
        .from(resumeVersions)
        .where(eq(resumeVersions.id, input.resumeVersionId))
        .limit(1);
      if (!resume) throw new Error("Resume version not found");

      const [interview] = await database.insert(interviews).values({
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
      }).returning({ id: interviews.id });

      return {
        interviewId: interview.id,
        resumeSummary: buildResumeSummary(resume.parsedJson, resume.extractedText),
      };
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
        const [existing] = await tx.select({ id: interviewMessages.id })
          .from(interviewMessages)
          .where(and(
            eq(interviewMessages.interviewId, input.interviewId),
            eq(interviewMessages.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        if (existing) return false;

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

        await tx.update(interviewQuestions).set({
          answerText: input.content,
          answeredAt: new Date(),
        }).where(eq(interviewQuestions.id, question.id));
        await tx.insert(interviewMessages).values({
          interviewId: input.interviewId,
          runId: input.runId,
          sequence: Number(sequenceRow.sequence),
          idempotencyKey: input.idempotencyKey,
          role: "user",
          kind: "answer",
          content: input.content,
          questionId: question.id,
        });
        return true;
      });
    },
    async markCompleting(interviewId) {
      const updated = await database.update(interviews).set({
        status: "completing",
        updatedAt: new Date(),
      }).where(and(eq(interviews.id, interviewId), eq(interviews.status, "active")))
        .returning({ id: interviews.id });
      return updated.length > 0;
    },
  };
}

function buildResumeSummary(parsedJson: unknown, extractedText: string | null) {
  return indexResumeEvidence(parsedJson, extractedText ?? "").overview;
}
