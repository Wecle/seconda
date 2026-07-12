import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { interviewQuestions, interviews, questionScores, resumeVersions } from "@/lib/db/schema";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { scoreInterviewAnswer } from "@/lib/interview";
import type { ParsedResume } from "@/lib/resume/types";

type Database = typeof import("@/lib/db").db;

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
}) {
  const concurrency = Math.min(options?.concurrency ?? 3, 3);
  const maxAttempts = options?.maxAttempts ?? 3;
  const [context] = await database.select({
    interview: interviews,
    parsedJson: resumeVersions.parsedJson,
  }).from(interviews).innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
    .where(eq(interviews.id, interviewId)).limit(1);
  if (!context) throw new Error("Interview not found");
  const questions = await database.select().from(interviewQuestions).where(and(
    eq(interviewQuestions.interviewId, interviewId),
    isNotNull(interviewQuestions.answeredAt),
    inArray(interviewQuestions.scoreStatus, ["pending", "failed", "scoring"]),
    lt(interviewQuestions.scoreAttemptCount, maxAttempts),
  )).orderBy(asc(interviewQuestions.questionIndex));
  const resume = context.parsedJson as ParsedResume | null;
  const resumeContext = resume ? `${resume.name} - ${resume.title}. Skills: ${resume.skills.join(", ")}` : "";
  const failures: unknown[] = [];
  await mapWithConcurrency(questions, concurrency, async (question) => {
    if (options?.signal?.aborted) throw options.signal.reason;
    const claimed = await database.update(interviewQuestions).set({
      scoreStatus: "scoring",
      scoreAttemptCount: sql`${interviewQuestions.scoreAttemptCount} + 1`,
      scoreErrorJson: null,
    }).where(and(
      eq(interviewQuestions.id, question.id),
      inArray(interviewQuestions.scoreStatus, ["pending", "failed", "scoring"]),
      lt(interviewQuestions.scoreAttemptCount, maxAttempts),
    )).returning({ attemptCount: interviewQuestions.scoreAttemptCount });
    if (!claimed[0]) return;
    try {
      const result = await scoreInterviewAnswer({
        question: question.question,
        answer: question.answerText!,
        questionType: question.questionType,
        level: context.interview.configVersion === 2 ? "adaptive" : context.interview.level,
        persona: context.interview.persona,
        language: context.interview.language,
        resumeContext,
      });
      await database.transaction(async (tx) => {
        await tx.insert(questionScores).values({ questionId: question.id, ...result.scores })
          .onConflictDoNothing({ target: questionScores.questionId });
        await tx.update(interviewQuestions).set({
          feedbackJson: {
            strengths: result.strengths,
            improvements: result.improvements,
            advice: result.advice,
            deepDive: result.deepDive,
          },
          scoreStatus: "scored",
          scoreErrorJson: null,
        }).where(eq(interviewQuestions.id, question.id));
      });
    } catch (error) {
      failures.push(error);
      await database.update(interviewQuestions).set({
        scoreStatus: claimed[0].attemptCount >= maxAttempts ? "failed" : "pending",
        scoreErrorJson: sanitizeAIError(error),
      }).where(eq(interviewQuestions.id, question.id));
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
