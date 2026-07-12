import { and, desc, eq, sql } from "drizzle-orm";
import {
  interviewAnswerAssessments,
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviews,
  resumeVersions,
} from "@/lib/db/schema";
import type { AnswerAssessment } from "./contracts";
import { assessAnswer, type AssessmentInput } from "./assessment";
import { indexResumeEvidence } from "./context/resume-evidence";

type AgentDatabase = typeof import("@/lib/db").db;

type StoredAssessment = {
  id: string;
  value: AnswerAssessment;
};

export async function ensureAssessment(options: {
  findExisting: () => Promise<StoredAssessment | null>;
  assess: () => Promise<AnswerAssessment>;
  commit: (value: AnswerAssessment) => Promise<StoredAssessment & { created: boolean }>;
}) {
  const existing = await options.findExisting();
  if (existing) return { ...existing, created: false };
  return options.commit(await options.assess());
}

export async function ensureLatestAnswerAssessment(
  database: AgentDatabase,
  input: { interviewId: string; signal?: AbortSignal },
) {
  const [answer] = await database.select({
    messageId: interviewMessages.id,
    content: interviewMessages.content,
    questionId: interviewQuestions.id,
    question: interviewQuestions.question,
    category: interviewQuestions.questionType,
    topic: interviewQuestions.topic,
    parsedJson: resumeVersions.parsedJson,
    extractedText: resumeVersions.extractedText,
  }).from(interviewMessages)
    .innerJoin(interviewQuestions, eq(interviewQuestions.id, interviewMessages.questionId))
    .innerJoin(interviews, eq(interviews.id, interviewMessages.interviewId))
    .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
    .where(and(
      eq(interviewMessages.interviewId, input.interviewId),
      eq(interviewMessages.role, "user"),
      eq(interviewMessages.kind, "answer"),
    ))
    .orderBy(desc(interviewMessages.sequence))
    .limit(1);
  if (!answer) throw new Error("No durable candidate answer exists for assessment");

  const readExisting = async () => {
    const [row] = await database.select().from(interviewAnswerAssessments)
      .where(eq(interviewAnswerAssessments.answerMessageId, answer.messageId)).limit(1);
    return row ? toStoredAssessment(row) : null;
  };
  const coverage = await database.select({
    category: interviewCoverage.category,
    topic: interviewCoverage.topic,
    depth: interviewCoverage.depth,
    evidenceQuality: interviewCoverage.evidenceQuality,
    status: interviewCoverage.status,
  }).from(interviewCoverage).where(eq(interviewCoverage.interviewId, input.interviewId));
  const evidence = indexResumeEvidence(answer.parsedJson, answer.extractedText ?? "");
  const assessmentInput: AssessmentInput = {
    question: answer.question,
    answer: answer.content,
    category: answer.category,
    topic: answer.topic,
    coverage,
    resumeEvidence: evidence.directory,
  };

  return ensureAssessment({
    findExisting: readExisting,
    assess: () => assessAnswer(assessmentInput, input.signal),
    commit: async (value) => database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${answer.messageId}))`);
      const [created] = await tx.insert(interviewAnswerAssessments).values({
        interviewId: input.interviewId,
        questionId: answer.questionId,
        answerMessageId: answer.messageId,
        completeness: value.completeness,
        specificity: value.specificity,
        evidenceStrength: value.evidenceStrength,
        reflectionDepth: value.reflectionDepth,
        followUpNeeded: value.followUpNeeded ? 1 : 0,
        missingPoints: value.missingPoints,
        extractedEvidence: value.extractedEvidence,
        publicSummary: value.publicSummary,
      }).onConflictDoNothing({ target: interviewAnswerAssessments.answerMessageId })
        .returning({ id: interviewAnswerAssessments.id });
      const stored = created
        ? { id: created.id, value }
        : await readExisting();
      if (!stored) throw new Error("Assessment idempotency winner could not be loaded");
      const patch = assessmentToCoveragePatch(stored.value);
      await tx.update(interviewCoverage).set({
        ...patch,
        lastAssessmentId: stored.id,
        updatedAt: new Date(),
      }).where(and(
        eq(interviewCoverage.interviewId, input.interviewId),
        eq(interviewCoverage.category, answer.category),
        eq(interviewCoverage.topic, "__category__"),
      ));
      return { ...stored, created: Boolean(created) };
    }),
  });
}

export function assessmentToCoveragePatch(assessment: AnswerAssessment) {
  const depth = { low: 1, medium: 2, high: 3 }[assessment.completeness];
  const evidenceQuality = { weak: 1, partial: 2, strong: 3 }[assessment.evidenceStrength];
  return {
    depth,
    evidenceQuality,
    status: assessment.followUpNeeded ? "partial" : "sufficient",
  };
}

function toStoredAssessment(row: typeof interviewAnswerAssessments.$inferSelect): StoredAssessment {
  return {
    id: row.id,
    value: {
      completeness: row.completeness as AnswerAssessment["completeness"],
      specificity: row.specificity as AnswerAssessment["specificity"],
      evidenceStrength: row.evidenceStrength as AnswerAssessment["evidenceStrength"],
      reflectionDepth: row.reflectionDepth as AnswerAssessment["reflectionDepth"],
      followUpNeeded: row.followUpNeeded === 1,
      missingPoints: row.missingPoints,
      extractedEvidence: row.extractedEvidence,
      publicSummary: row.publicSummary,
    },
  };
}
