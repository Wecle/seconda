import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { interviewQuestions, interviewResumeSnapshots, interviews, questionScores } from "@/lib/db/schema";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { scoreInterviewAnswer } from "@/lib/interview";
import type { ParsedResume } from "@/lib/resume/types";
import { assertCompletionLease } from "./fencing";
import type { CompletionLeaseToken } from "./repository";

type Database = typeof import("@/lib/db").db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function mapWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await task(item);
    }
  });
  await Promise.all(workers);
}

export async function scorePendingInterviewQuestions(database: Database, interviewId: string, options?: {
  concurrency?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  jobId?: string;
  lease?: CompletionLeaseToken;
}) {
  const concurrency = Math.min(options?.concurrency ?? 3, 3);
  const maxAttempts = options?.maxAttempts ?? 3;
  const [context] = await database.select({
    interview: interviews,
    parsedJson: interviewResumeSnapshots.parsedJson,
  }).from(interviews).innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .where(eq(interviews.id, interviewId)).limit(1);
  if (!context) throw new Error("Interview not found");
  const resume = context.parsedJson as ParsedResume | null;
  const resumeContext = resume ? `${resume.name} - ${resume.title}. Skills: ${resume.skills.join(", ")}` : "";
  await database.transaction(async (tx) => {
    await assertLeaseIfConfigured(tx, options);
    await tx.update(interviewQuestions).set({ scoreStatus: "pending" }).where(and(
      eq(interviewQuestions.interviewId, interviewId),
      eq(interviewQuestions.scoreStatus, "scoring"),
    ));
    await tx.update(interviewQuestions).set({ scoreStatus: "scored", scoreErrorJson: null }).where(and(
      eq(interviewQuestions.interviewId, interviewId),
      isNotNull(interviewQuestions.answeredAt),
      inArray(
        interviewQuestions.id,
        tx.select({ questionId: questionScores.questionId }).from(questionScores),
      ),
    ));
  });
  const questions = await database.select().from(interviewQuestions).where(and(
    eq(interviewQuestions.interviewId, interviewId),
    isNotNull(interviewQuestions.answeredAt),
    inArray(interviewQuestions.scoreStatus, ["pending", "failed"]),
    lt(interviewQuestions.scoreAttemptCount, maxAttempts),
  )).orderBy(asc(interviewQuestions.questionIndex));
  const failures: unknown[] = [];
  await mapWithConcurrency(questions, concurrency, async (question) => {
    if (options?.signal?.aborted) throw options.signal.reason;
    const claimed = await database.transaction(async (tx) => {
      await assertLeaseIfConfigured(tx, options);
      return tx.update(interviewQuestions).set({
        scoreStatus: "scoring",
        scoreAttemptCount: sql`${interviewQuestions.scoreAttemptCount} + 1`,
        scoreErrorJson: null,
      }).where(and(
        eq(interviewQuestions.id, question.id),
        inArray(interviewQuestions.scoreStatus, ["pending", "failed"]),
        lt(interviewQuestions.scoreAttemptCount, maxAttempts),
      )).returning({ attemptCount: interviewQuestions.scoreAttemptCount });
    });
    if (!claimed[0]) return;
    try {
      const [existingScore] = await database.select({ id: questionScores.id }).from(questionScores)
        .where(eq(questionScores.questionId, question.id)).limit(1);
      if (existingScore) {
        await database.transaction(async (tx) => {
          await assertLeaseIfConfigured(tx, options);
          await tx.update(interviewQuestions).set({ scoreStatus: "scored", scoreErrorJson: null }).where(and(
            eq(interviewQuestions.id, question.id),
            eq(interviewQuestions.scoreStatus, "scoring"),
            eq(interviewQuestions.scoreAttemptCount, claimed[0].attemptCount),
          ));
        });
        return;
      }
      const result = await scoreInterviewAnswer({
        question: question.question,
        answer: question.answerText!,
        questionType: question.questionType,
        level: context.interview.configVersion === 2 ? "adaptive" : context.interview.level,
        persona: context.interview.persona,
        language: context.interview.language,
        resumeContext,
        signal: options?.signal,
      });
      await database.transaction(async (tx) => {
        await assertLeaseIfConfigured(tx, options);
        const inserted = await tx.insert(questionScores).values({ questionId: question.id, ...result.scores })
          .onConflictDoNothing({ target: questionScores.questionId })
          .returning({ id: questionScores.id });
        const committed = await tx.update(interviewQuestions).set({
          feedbackJson: inserted.length > 0 ? {
            strengths: result.strengths,
            improvements: result.improvements,
            advice: result.advice,
            deepDive: result.deepDive,
          } : question.feedbackJson,
          scoreStatus: "scored",
          scoreErrorJson: null,
        }).where(and(
          eq(interviewQuestions.id, question.id),
          eq(interviewQuestions.scoreStatus, "scoring"),
          eq(interviewQuestions.scoreAttemptCount, claimed[0].attemptCount),
        )).returning({ id: interviewQuestions.id });
        if (committed.length === 0) throw new Error("Question score could not be committed");
      });
    } catch (error) {
      if (options?.signal?.aborted) throw options.signal.reason ?? error;
      failures.push(error);
      await database.transaction(async (tx) => {
        await assertLeaseIfConfigured(tx, options);
        await tx.update(interviewQuestions).set({
          scoreStatus: claimed[0].attemptCount >= maxAttempts ? "failed" : "pending",
          scoreErrorJson: sanitizeAIError(error),
        }).where(and(
          eq(interviewQuestions.id, question.id),
          eq(interviewQuestions.scoreStatus, "scoring"),
          eq(interviewQuestions.scoreAttemptCount, claimed[0].attemptCount),
        ));
      });
    }
  });
  const remaining = await database.select({ id: interviewQuestions.id }).from(interviewQuestions).where(and(
    eq(interviewQuestions.interviewId, interviewId),
    isNotNull(interviewQuestions.answeredAt),
    inArray(interviewQuestions.scoreStatus, ["pending", "scoring", "failed"]),
  ));
  if (remaining.length > 0) throw failures[0] ?? new Error(`${remaining.length} answers remain unscored`);
  return { scored: questions.length };
}

async function assertLeaseIfConfigured(
  database: Database | Transaction,
  options?: { jobId?: string; lease?: CompletionLeaseToken },
) {
  if (!options?.jobId && !options?.lease) return;
  if (!options.jobId || !options.lease) throw new Error("Completion job id and lease must be provided together");
  await assertCompletionLease(database, options.jobId, options.lease);
}
