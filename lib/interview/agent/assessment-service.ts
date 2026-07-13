import { and, desc, eq, sql } from "drizzle-orm";
import {
  interviewAnswerAssessments,
  interviewAnswerAssessmentClaims,
  interviewAgentRuns,
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
} from "@/lib/db/schema";
import type { AnswerAssessment } from "./contracts";
import { assessAnswer, type AssessmentInput } from "./assessment";
import { indexResumeEvidence } from "./context/resume-evidence";
import type { RunLeaseToken } from "./repository";
import { agentRunFence } from "./fencing";

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
  input: {
    interviewId: string;
    runId: string;
    lease: RunLeaseToken;
    signal?: AbortSignal;
    assess?: (assessmentInput: AssessmentInput, signal?: AbortSignal) => Promise<AnswerAssessment>;
  },
) {
  const [answer] = await database.select({
    messageId: interviewMessages.id,
    content: interviewMessages.content,
    questionId: interviewQuestions.id,
    question: interviewQuestions.question,
    category: interviewQuestions.questionType,
    topic: interviewQuestions.topic,
    parsedJson: interviewResumeSnapshots.parsedJson,
    extractedText: interviewResumeSnapshots.extractedText,
  }).from(interviewMessages)
    .innerJoin(interviewQuestions, eq(interviewQuestions.id, interviewMessages.questionId))
    .innerJoin(interviews, eq(interviews.id, interviewMessages.interviewId))
    .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
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

  const existing = await readExisting();
  if (existing) return { ...existing, created: false };

  const claimed = await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${answer.messageId}))`);
    const [stored] = await tx.select().from(interviewAnswerAssessments)
      .where(eq(interviewAnswerAssessments.answerMessageId, answer.messageId)).limit(1);
    if (stored) return toStoredAssessment(stored);
    const [run] = await tx.select({ leaseExpiresAt: interviewAgentRuns.leaseExpiresAt })
      .from(interviewAgentRuns)
      .where(agentRunFence(input.runId, input.lease))
      .limit(1);
    if (!run?.leaseExpiresAt) throw new Error("Agent run lease is stale");
    const [currentClaim] = await tx.select().from(interviewAnswerAssessmentClaims)
      .where(eq(interviewAnswerAssessmentClaims.answerMessageId, answer.messageId))
      .limit(1);
    if (currentClaim && currentClaim.claimExpiresAt > new Date()) {
      throw new Error("Answer assessment is already in progress");
    }
    await tx.insert(interviewAnswerAssessmentClaims).values({
      answerMessageId: answer.messageId,
      runId: input.runId,
      leaseOwner: input.lease.owner,
      leaseGeneration: input.lease.generation,
      claimExpiresAt: run.leaseExpiresAt,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: interviewAnswerAssessmentClaims.answerMessageId,
      set: {
        runId: input.runId,
        leaseOwner: input.lease.owner,
        leaseGeneration: input.lease.generation,
        claimExpiresAt: run.leaseExpiresAt,
        updatedAt: new Date(),
      },
    });
    return null;
  });
  if (claimed) return { ...claimed, created: false };

  if (input.signal?.aborted) throw input.signal.reason ?? new Error("Assessment aborted");
  const fenced = await database.select({ id: interviewAgentRuns.id })
    .from(interviewAgentRuns)
    .where(agentRunFence(input.runId, input.lease))
    .limit(1);
  if (fenced.length === 0) throw new Error("Agent run lease is stale");
  const value = await (input.assess ?? assessAnswer)(assessmentInput, input.signal);

  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${answer.messageId}))`);
    const [leasedRun] = await tx.select({ id: interviewAgentRuns.id })
      .from(interviewAgentRuns)
      .where(agentRunFence(input.runId, input.lease))
      .limit(1);
    if (!leasedRun) throw new Error("Agent run lease is stale");
    const [claim] = await tx.select().from(interviewAnswerAssessmentClaims)
      .where(and(
        eq(interviewAnswerAssessmentClaims.answerMessageId, answer.messageId),
        eq(interviewAnswerAssessmentClaims.runId, input.runId),
        eq(interviewAnswerAssessmentClaims.leaseOwner, input.lease.owner),
        eq(interviewAnswerAssessmentClaims.leaseGeneration, input.lease.generation),
      )).limit(1);
    if (!claim) throw new Error("Answer assessment claim is stale");
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
    let finalStored: StoredAssessment | null = created ? { id: created.id, value } : null;
    if (!finalStored) {
      const [existingStored] = await tx.select().from(interviewAnswerAssessments)
        .where(eq(interviewAnswerAssessments.answerMessageId, answer.messageId)).limit(1);
      finalStored = existingStored ? toStoredAssessment(existingStored) : null;
    }
    if (!finalStored) throw new Error("Assessment idempotency winner could not be loaded");
    const patch = assessmentToCoveragePatch(finalStored.value);
    await tx.update(interviewCoverage).set({
        ...patch,
        lastAssessmentId: finalStored.id,
        updatedAt: new Date(),
      }).where(and(
        eq(interviewCoverage.interviewId, input.interviewId),
        eq(interviewCoverage.category, answer.category),
        eq(interviewCoverage.topic, "__category__"),
    ));
    await tx.delete(interviewAnswerAssessmentClaims).where(and(
        eq(interviewAnswerAssessmentClaims.answerMessageId, answer.messageId),
        eq(interviewAnswerAssessmentClaims.runId, input.runId),
        eq(interviewAnswerAssessmentClaims.leaseOwner, input.lease.owner),
        eq(interviewAnswerAssessmentClaims.leaseGeneration, input.lease.generation),
    ));
    return { ...finalStored, created: Boolean(created) };
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
