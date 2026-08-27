import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import {
  agentSessions,
  interviewAnswers,
  interviewCompletionJobs,
  interviewQuestions,
  interviewReports,
  interviewResumeSnapshots,
  interviews,
  questionScores,
} from "@/lib/db/schema";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import type { InterviewDatabase, InterviewTransaction } from "./repository";
import { InterviewApplicationError } from "../domain/errors";
import {
  computeInterviewAggregates,
  dimensionAveragesSchema,
  questionFeedbackSchema,
  questionScoresSchema,
  reportSummarySchema,
  validateQuestionOverall,
  type DimensionAverages,
  type QuestionEvaluation,
  type ReportSummary,
  type ScoredQuestionInput,
} from "../domain/scoring";

const COMPLETION_JOB_LEASE_MS = 60_000;

function leaseExpiry(durationMs = COMPLETION_JOB_LEASE_MS) {
  return new Date(Date.now() + durationMs);
}

export type SafeCompletionErrorCode =
  | "STRUCTURED_OUTPUT_FAILED"
  | "CONTENT_FILTERED"
  | "UPSTREAM_API_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR"
  | "COMPLETION_FAILED";

export type SafeCompletionError = {
  code: SafeCompletionErrorCode;
  category: "structured-output" | "content-filter" | "api" | "network" | "internal" | "unknown";
  retryable: boolean;
};

export function sanitizeCompletionError(error: unknown): SafeCompletionError {
  const safeAI = sanitizeAIError(error);
  let code: SafeCompletionErrorCode = "COMPLETION_FAILED";
  let category: SafeCompletionError["category"] = safeAI.category;
  let retryable = safeAI.retryable;

  if (category === "content-filter") {
    code = "CONTENT_FILTERED";
    retryable = false;
  } else if (category === "structured-output") {
    code = "STRUCTURED_OUTPUT_FAILED";
    retryable = true;
  } else if (category === "api") {
    code = "UPSTREAM_API_ERROR";
    retryable = safeAI.retryable;
  } else if (category === "network") {
    code = "NETWORK_ERROR";
    retryable = true;
  } else {
    category = "internal";
    code = "INTERNAL_ERROR";
    retryable = true;
  }

  return {
    code,
    category,
    retryable,
  };
}

export async function ensureCompletionJobInTransaction(
  transaction: InterviewTransaction,
  interviewId: string,
) {
  const [existing] = await transaction
    .select()
    .from(interviewCompletionJobs)
    .where(eq(interviewCompletionJobs.interviewId, interviewId))
    .limit(1)
    .for("update");

  if (existing) return existing;

  const [created] = await transaction
    .insert(interviewCompletionJobs)
    .values({
      interviewId,
      status: "pending",
      attemptCount: 0,
    })
    .returning();

  return created;
}

export async function claimCompletionJob(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
  leaseDurationMs?: number;
}) {
  return input.database.transaction(async (transaction) => {
    const [interview] = await transaction
      .select()
      .from(interviews)
      .where(and(eq(interviews.id, input.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");

    if (!interview) return { state: "not_found" as const };

    if (interview.status === "completed") {
      return { state: "completed" as const };
    }

    if (interview.status !== "completing") {
      return { state: "invalid_state" as const, status: interview.status };
    }

    const [session] = await transaction
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.id, interview.agentSessionId), eq(agentSessions.userId, input.userId)))
      .limit(1)
      .for("update");

    if (!session || session.capability !== "interview") {
      return { state: "invalid_state" as const, reason: "invalid_session_capability" as const };
    }

    const [job] = await transaction
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, input.interviewId))
      .limit(1)
      .for("update");

    if (!job) return { state: "not_found" as const };

    if (job.status === "completed") {
      return { state: "completed" as const, job };
    }

    const now = new Date();
    const takingOver =
      (job.status === "scoring" || job.status === "reporting") &&
      (!job.claimExpiresAt || job.claimExpiresAt <= now);

    if (job.status === "failed") {
      return {
        state: "unavailable" as const,
        status: "failed" as const,
      };
    }

    if (job.status !== "pending" && !takingOver) {
      return {
        state: "unavailable" as const,
        status: job.status,
        claimExpiresAt: job.claimExpiresAt,
      };
    }

    const newClaimToken = randomUUID();
    const newExpiresAt = leaseExpiry(input.leaseDurationMs);

    const [claimedJob] = await transaction
      .update(interviewCompletionJobs)
      .set({
        status: "scoring",
        attemptCount: sql`${interviewCompletionJobs.attemptCount} + 1`,
        claimToken: newClaimToken,
        claimExpiresAt: newExpiresAt,
        errorJson: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(interviewCompletionJobs.id, job.id),
          takingOver
            ? and(
                inArray(interviewCompletionJobs.status, ["scoring", "reporting"]),
                or(
                  isNull(interviewCompletionJobs.claimExpiresAt),
                  lte(interviewCompletionJobs.claimExpiresAt, now),
                ),
              )
            : eq(interviewCompletionJobs.status, "pending"),
        ),
      )
      .returning();

    if (!claimedJob) {
      return { state: "unavailable" as const, status: job.status };
    }

    if (takingOver) {
      const questions = await transaction
        .select({ id: interviewQuestions.id })
        .from(interviewQuestions)
        .where(eq(interviewQuestions.interviewId, interview.id));

      const questionIds = questions.map((q) => q.id);
      if (questionIds.length > 0) {
        await transaction
          .update(questionScores)
          .set({
            status: "pending",
            claimToken: null,
            claimExpiresAt: null,
            errorJson: null,
            updatedAt: now,
          })
          .where(
            and(
              inArray(questionScores.questionId, questionIds),
              eq(questionScores.status, "scoring"),
            ),
          );
      }
    }

    return {
      state: "claimed" as const,
      job: claimedJob,
      claimToken: newClaimToken,
      interview,
    };
  });
}

export async function renewCompletionClaim(input: {
  database: InterviewDatabase;
  jobId: string;
  claimToken: string;
  leaseDurationMs?: number;
}) {
  const [renewed] = await input.database
    .update(interviewCompletionJobs)
    .set({
      claimExpiresAt: leaseExpiry(input.leaseDurationMs),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(interviewCompletionJobs.id, input.jobId),
        eq(interviewCompletionJobs.claimToken, input.claimToken),
        gt(interviewCompletionJobs.claimExpiresAt, new Date()),
        inArray(interviewCompletionJobs.status, ["scoring", "reporting"]),
      ),
    )
    .returning({ id: interviewCompletionJobs.id });

  return Boolean(renewed);
}

export async function ensurePendingQuestionScoresInTransaction(
  transaction: InterviewTransaction,
  interviewId: string,
) {
  const questions = await transaction
    .select({
      id: interviewQuestions.id,
      sequence: interviewQuestions.sequence,
      topic: interviewQuestions.topic,
      question: interviewQuestions.question,
      status: interviewQuestions.status,
      answerContent: interviewAnswers.content,
      answerStatus: interviewAnswers.status,
    })
    .from(interviewQuestions)
    .innerJoin(interviewAnswers, eq(interviewAnswers.questionId, interviewQuestions.id))
    .where(
      and(
        eq(interviewQuestions.interviewId, interviewId),
        eq(interviewQuestions.status, "answered"),
        eq(interviewAnswers.status, "answered"),
      ),
    )
    .orderBy(asc(interviewQuestions.sequence));

  const scorableQuestions = questions.filter(
    (q) => q.answerContent && q.answerContent.trim().length > 0,
  );

  for (const q of scorableQuestions) {
    const [existing] = await transaction
      .select({ id: questionScores.id })
      .from(questionScores)
      .where(eq(questionScores.questionId, q.id))
      .limit(1)
      .for("update");

    if (!existing) {
      await transaction.insert(questionScores).values({
        questionId: q.id,
        status: "pending",
        attemptCount: 0,
      });
    }
  }

  return scorableQuestions;
}

export async function claimNextQuestionScore(input: {
  database: InterviewDatabase;
  interviewId: string;
  jobId: string;
  jobClaimToken: string;
  leaseDurationMs?: number;
}) {
  return input.database.transaction(async (transaction) => {
    const now = new Date();

    const [job] = await transaction
      .select({ id: interviewCompletionJobs.id })
      .from(interviewCompletionJobs)
      .where(
        and(
          eq(interviewCompletionJobs.id, input.jobId),
          eq(interviewCompletionJobs.interviewId, input.interviewId),
          eq(interviewCompletionJobs.claimToken, input.jobClaimToken),
          gt(interviewCompletionJobs.claimExpiresAt, now),
          eq(interviewCompletionJobs.status, "scoring"),
        ),
      )
      .limit(1)
      .for("update");

    if (!job) {
      return { state: "job_invalid" as const };
    }

    const availableScores = await transaction
      .select({
        scoreId: questionScores.id,
        questionId: questionScores.questionId,
        status: questionScores.status,
        claimExpiresAt: questionScores.claimExpiresAt,
        attemptCount: questionScores.attemptCount,
        sequence: interviewQuestions.sequence,
        topic: interviewQuestions.topic,
        question: interviewQuestions.question,
        answerContent: interviewAnswers.content,
      })
      .from(questionScores)
      .innerJoin(interviewQuestions, eq(interviewQuestions.id, questionScores.questionId))
      .innerJoin(interviewAnswers, eq(interviewAnswers.questionId, questionScores.questionId))
      .where(
        and(
          eq(interviewQuestions.interviewId, input.interviewId),
          eq(interviewQuestions.status, "answered"),
          eq(interviewAnswers.status, "answered"),
          or(
            eq(questionScores.status, "pending"),
            and(
              eq(questionScores.status, "scoring"),
              or(
                isNull(questionScores.claimExpiresAt),
                lte(questionScores.claimExpiresAt, now),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(interviewQuestions.sequence))
      .limit(1)
      .for("update", { of: questionScores });

    if (availableScores.length === 0) {
      return { state: "none_pending" as const };
    }

    const target = availableScores[0];
    const scoreClaimToken = randomUUID();
    const scoreExpiresAt = leaseExpiry(input.leaseDurationMs);

    const [claimedScore] = await transaction
      .update(questionScores)
      .set({
        status: "scoring",
        claimToken: scoreClaimToken,
        claimExpiresAt: scoreExpiresAt,
        attemptCount: sql`${questionScores.attemptCount} + 1`,
        errorJson: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(questionScores.id, target.scoreId),
          or(
            eq(questionScores.status, "pending"),
            and(
              eq(questionScores.status, "scoring"),
              or(
                isNull(questionScores.claimExpiresAt),
                lte(questionScores.claimExpiresAt, now),
              ),
            ),
          ),
        ),
      )
      .returning();

    if (!claimedScore) {
      return { state: "none_pending" as const };
    }

    return {
      state: "claimed" as const,
      scoreId: claimedScore.id,
      questionId: target.questionId,
      sequence: target.sequence,
      topic: target.topic,
      question: target.question,
      answerContent: target.answerContent ?? "",
      scoreClaimToken,
    };
  });
}

export async function renewQuestionScoreClaim(input: {
  database: InterviewDatabase;
  interviewId: string;
  jobId: string;
  jobClaimToken: string;
  scoreId: string;
  scoreClaimToken: string;
  leaseDurationMs?: number;
}) {
  return input.database.transaction(async (transaction) => {
    const now = new Date();

    const [job] = await transaction
      .select({ id: interviewCompletionJobs.id })
      .from(interviewCompletionJobs)
      .where(
        and(
          eq(interviewCompletionJobs.id, input.jobId),
          eq(interviewCompletionJobs.interviewId, input.interviewId),
          eq(interviewCompletionJobs.claimToken, input.jobClaimToken),
          eq(interviewCompletionJobs.status, "scoring"),
          gt(interviewCompletionJobs.claimExpiresAt, now),
        ),
      )
      .limit(1)
      .for("update");

    if (!job) {
      return false;
    }

    const [renewed] = await transaction
      .update(questionScores)
      .set({
        claimExpiresAt: leaseExpiry(input.leaseDurationMs),
        updatedAt: now,
      })
      .where(
        and(
          eq(questionScores.id, input.scoreId),
          eq(questionScores.claimToken, input.scoreClaimToken),
          eq(questionScores.status, "scoring"),
          gt(questionScores.claimExpiresAt, now),
        ),
      )
      .returning({ id: questionScores.id });

    return Boolean(renewed);
  });
}

export async function commitClaimedQuestionScore(input: {
  database: InterviewDatabase;
  interviewId: string;
  jobId: string;
  jobClaimToken: string;
  scoreId: string;
  questionId: string;
  scoreClaimToken: string;
  evaluation: QuestionEvaluation;
  overall: number;
}) {
  return input.database.transaction(async (transaction) => {
    const now = new Date();

    const [job] = await transaction
      .select({ id: interviewCompletionJobs.id })
      .from(interviewCompletionJobs)
      .where(
        and(
          eq(interviewCompletionJobs.id, input.jobId),
          eq(interviewCompletionJobs.interviewId, input.interviewId),
          eq(interviewCompletionJobs.claimToken, input.jobClaimToken),
          gt(interviewCompletionJobs.claimExpiresAt, now),
          eq(interviewCompletionJobs.status, "scoring"),
        ),
      )
      .limit(1)
      .for("update");

    if (!job) {
      throw new Error("Completion job claim is invalid or expired");
    }

    const [question] = await transaction
      .select({ id: interviewQuestions.id })
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.id, input.questionId),
          eq(interviewQuestions.interviewId, input.interviewId),
        ),
      )
      .limit(1);

    if (!question) {
      throw new Error("Question does not belong to interview");
    }

    const [score] = await transaction
      .update(questionScores)
      .set({
        understanding: input.evaluation.scores.understanding,
        expression: input.evaluation.scores.expression,
        logic: input.evaluation.scores.logic,
        depth: input.evaluation.scores.depth,
        authenticity: input.evaluation.scores.authenticity,
        reflection: input.evaluation.scores.reflection,
        overall: input.overall.toFixed(1),
        feedbackJson: {
          strengths: input.evaluation.strengths,
          improvements: input.evaluation.improvements,
          advice: input.evaluation.advice,
        },
        status: "scored",
        claimToken: null,
        claimExpiresAt: null,
        errorJson: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(questionScores.id, input.scoreId),
          eq(questionScores.questionId, input.questionId),
          eq(questionScores.claimToken, input.scoreClaimToken),
          gt(questionScores.claimExpiresAt, now),
          eq(questionScores.status, "scoring"),
        ),
      )
      .returning();

    if (!score) {
      throw new Error("Score claim is invalid or expired");
    }

    return score;
  });
}

export async function failClaimedQuestionScore(input: {
  database: InterviewDatabase;
  interviewId: string;
  jobId: string;
  jobClaimToken: string;
  scoreId: string;
  questionId: string;
  scoreClaimToken: string;
  error: unknown;
}) {
  return input.database.transaction(async (transaction) => {
    const now = new Date();

    const [job] = await transaction
      .select({ id: interviewCompletionJobs.id })
      .from(interviewCompletionJobs)
      .where(
        and(
          eq(interviewCompletionJobs.id, input.jobId),
          eq(interviewCompletionJobs.interviewId, input.interviewId),
          eq(interviewCompletionJobs.claimToken, input.jobClaimToken),
          gt(interviewCompletionJobs.claimExpiresAt, now),
          eq(interviewCompletionJobs.status, "scoring"),
        ),
      )
      .limit(1);

    if (!job) return false;

    const [failed] = await transaction
      .update(questionScores)
      .set({
        status: "failed",
        errorJson: sanitizeCompletionError(input.error),
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(questionScores.id, input.scoreId),
          eq(questionScores.questionId, input.questionId),
          eq(questionScores.claimToken, input.scoreClaimToken),
          gt(questionScores.claimExpiresAt, now),
          eq(questionScores.status, "scoring"),
        ),
      )
      .returning({ id: questionScores.id });

    return Boolean(failed);
  });
}

export async function transitionJobToReporting(input: {
  database: InterviewDatabase;
  jobId: string;
  claimToken: string;
}) {
  const [updated] = await input.database
    .update(interviewCompletionJobs)
    .set({
      status: "reporting",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(interviewCompletionJobs.id, input.jobId),
        eq(interviewCompletionJobs.claimToken, input.claimToken),
        gt(interviewCompletionJobs.claimExpiresAt, new Date()),
        eq(interviewCompletionJobs.status, "scoring"),
      ),
    )
    .returning({ id: interviewCompletionJobs.id });

  return Boolean(updated);
}

export async function commitCompletionReport(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
  jobId: string;
  claimToken: string;
  summary: ReportSummary;
}) {
  return input.database.transaction(async (transaction) => {
    const now = new Date();

    const [interview] = await transaction
      .select()
      .from(interviews)
      .where(and(eq(interviews.id, input.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");

    if (!interview) {
      throw new Error("Interview not found or user unauthorized");
    }

    if (interview.status !== "completing") {
      throw new Error("Interview must be in completing status to commit report");
    }

    const [job] = await transaction
      .select()
      .from(interviewCompletionJobs)
      .where(
        and(
          eq(interviewCompletionJobs.id, input.jobId),
          eq(interviewCompletionJobs.interviewId, input.interviewId),
          eq(interviewCompletionJobs.claimToken, input.claimToken),
          gt(interviewCompletionJobs.claimExpiresAt, now),
          eq(interviewCompletionJobs.status, "reporting"),
        ),
      )
      .limit(1)
      .for("update");

    if (!job) {
      throw new Error("Completion job claim is invalid or expired");
    }

    // Load all questions and scores for this interview
    const allQuestions = await transaction
      .select({
        id: interviewQuestions.id,
        sequence: interviewQuestions.sequence,
        topic: interviewQuestions.topic,
        question: interviewQuestions.question,
        status: interviewQuestions.status,
        answerContent: interviewAnswers.content,
        answerStatus: interviewAnswers.status,
      })
      .from(interviewQuestions)
      .leftJoin(interviewAnswers, eq(interviewAnswers.questionId, interviewQuestions.id))
      .where(eq(interviewQuestions.interviewId, input.interviewId))
      .orderBy(asc(interviewQuestions.sequence));

    const scorableQuestions = allQuestions.filter(
      (q) =>
        q.status === "answered" &&
        q.answerStatus === "answered" &&
        q.answerContent &&
        q.answerContent.trim().length > 0,
    );

    const questionIds = allQuestions.map((q) => q.id);
    const scores = questionIds.length > 0
      ? await transaction
          .select()
          .from(questionScores)
          .where(inArray(questionScores.questionId, questionIds))
          .for("update")
      : [];

    const scoresMap = new Map(scores.map((s) => [s.questionId, s]));
    const scoredInputs: ScoredQuestionInput[] = [];

    for (const q of scorableQuestions) {
      const score = scoresMap.get(q.id);
      if (
        !score ||
        score.status !== "scored" ||
        score.understanding === null ||
        score.expression === null ||
        score.logic === null ||
        score.depth === null ||
        score.authenticity === null ||
        score.reflection === null
      ) {
        throw new Error(`Question ${q.sequence} is not in scored status (current: ${score?.status ?? "missing"})`);
      }

      const scoreObj = {
        understanding: score.understanding,
        expression: score.expression,
        logic: score.logic,
        depth: score.depth,
        authenticity: score.authenticity,
        reflection: score.reflection,
      };
      const parsedScores = questionScoresSchema.safeParse(scoreObj);
      if (!parsedScores.success) {
        throw new Error(`Question ${q.sequence} score dimensions are invalid`);
      }

      const parsedFeedback = questionFeedbackSchema.safeParse(score.feedbackJson);
      if (!parsedFeedback.success) {
        throw new Error(`Question ${q.sequence} feedback is invalid`);
      }

      const overallValidation = validateQuestionOverall(score.overall, parsedScores.data);
      if (!overallValidation.valid) {
        throw new Error(`Question ${q.sequence} overall score is invalid or contradictory: ${overallValidation.reason}`);
      }

      scoredInputs.push({
        questionId: q.id,
        scores: parsedScores.data,
        questionOverallTenths: overallValidation.questionOverallTenths,
      });
    }

    // Recompute aggregates deterministically
    const aggregates = computeInterviewAggregates(scoredInputs);

    const [report] = await transaction
      .insert(interviewReports)
      .values({
        interviewId: input.interviewId,
        overallScore: aggregates.overallScore,
        dimensionAveragesJson: aggregates.dimensionAverages,
        summaryJson: input.summary,
        scoreStatus: aggregates.scoreStatus,
        generatedAt: now,
      })
      .onConflictDoUpdate({
        target: interviewReports.interviewId,
        set: {
          overallScore: aggregates.overallScore,
          dimensionAveragesJson: aggregates.dimensionAverages,
          summaryJson: input.summary,
          scoreStatus: aggregates.scoreStatus,
          generatedAt: now,
        },
      })
      .returning();

    await transaction
      .update(interviewCompletionJobs)
      .set({
        status: "completed",
        completedAt: now,
        claimToken: null,
        claimExpiresAt: null,
        errorJson: null,
        updatedAt: now,
      })
      .where(eq(interviewCompletionJobs.id, job.id));

    await transaction
      .update(interviews)
      .set({
        status: "completed",
        completedAt: now,
        updatedAt: now,
        version: interview.version + 1,
      })
      .where(eq(interviews.id, interview.id));

    await transaction
      .update(agentSessions)
      .set({
        status: "idle",
        updatedAt: now,
      })
      .where(eq(agentSessions.id, interview.agentSessionId));

    await appendAgentEventsInTransaction(transaction, {
      sessionId: interview.agentSessionId,
      events: [
        {
          type: "interview/completed",
          payload: {
            interviewId: interview.id,
            scoreStatus: aggregates.scoreStatus,
            overallScore: aggregates.overallScore,
          },
          dedupeKey: `interview:completed:${interview.id}`,
          visibility: "model_and_user",
        },
      ],
    });

    return report;
  });
}

export async function failCompletionJob(input: {
  database: InterviewDatabase;
  jobId: string;
  claimToken: string;
  error: unknown;
}) {
  return input.database.transaction(async (transaction) => {
    const now = new Date();
    const sanitizedError = sanitizeCompletionError(input.error);

    const [job] = await transaction
      .select()
      .from(interviewCompletionJobs)
      .where(
        and(
          eq(interviewCompletionJobs.id, input.jobId),
          eq(interviewCompletionJobs.claimToken, input.claimToken),
          gt(interviewCompletionJobs.claimExpiresAt, now),
          inArray(interviewCompletionJobs.status, ["scoring", "reporting"]),
        ),
      )
      .limit(1)
      .for("update");

    if (!job) return false;

    const [interview] = await transaction
      .select({ id: interviews.id, agentSessionId: interviews.agentSessionId })
      .from(interviews)
      .where(eq(interviews.id, job.interviewId))
      .limit(1);

    await transaction
      .update(interviewCompletionJobs)
      .set({
        status: "failed",
        errorJson: sanitizedError,
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(interviewCompletionJobs.id, job.id));

    if (interview) {
      await appendAgentEventsInTransaction(transaction, {
        sessionId: interview.agentSessionId,
        events: [
          {
            type: "interview/completion_failed",
            payload: {
              interviewId: interview.id,
              completionJobId: job.id,
              code: sanitizedError.code,
            },
            dedupeKey: `interview:completion-failed:${job.id}:${job.attemptCount}`,
            visibility: "internal",
          },
        ],
      });
    }

    return true;
  });
}

export async function retryCompletionJob(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
}) {
  return input.database.transaction(async (transaction) => {
    const now = new Date();

    const [interview] = await transaction
      .select()
      .from(interviews)
      .where(and(eq(interviews.id, input.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");

    if (!interview) return { state: "not_found" as const };

    if (interview.status === "completed") {
      return { state: "completed" as const };
    }

    if (interview.status !== "completing") {
      return { state: "invalid_state" as const, status: interview.status };
    }

    const [job] = await transaction
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, interview.id))
      .limit(1)
      .for("update");

    if (!job) {
      const [newJob] = await transaction
        .insert(interviewCompletionJobs)
        .values({
          interviewId: interview.id,
          status: "pending",
          attemptCount: 0,
        })
        .returning();
      return { state: "ready" as const, job: newJob };
    }

    if (job.status === "completed") {
      return { state: "completed" as const, job };
    }

    if (job.status === "pending") {
      return { state: "ready" as const, job };
    }

    if (job.status === "scoring" || job.status === "reporting") {
      if (job.claimExpiresAt && job.claimExpiresAt > now) {
        return { state: "unavailable" as const, status: job.status };
      }
    }

    // Reset failed or scoring question scores so they can be re-scored
    const questions = await transaction
      .select({ id: interviewQuestions.id })
      .from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, interview.id));

    const questionIds = questions.map((q) => q.id);
    if (questionIds.length > 0) {
      await transaction
        .update(questionScores)
        .set({
          status: "pending",
          claimToken: null,
          claimExpiresAt: null,
          errorJson: null,
          updatedAt: now,
        })
        .where(
          and(
            inArray(questionScores.questionId, questionIds),
            inArray(questionScores.status, ["failed", "scoring"]),
          ),
        );
    }

    const [resetJob] = await transaction
      .update(interviewCompletionJobs)
      .set({
        status: "pending",
        claimToken: null,
        claimExpiresAt: null,
        errorJson: null,
        updatedAt: now,
      })
      .where(eq(interviewCompletionJobs.id, job.id))
      .returning();

    await appendAgentEventsInTransaction(transaction, {
      sessionId: interview.agentSessionId,
      events: [
        {
          type: "interview/completion_retried",
          payload: {
            interviewId: interview.id,
            completionJobId: job.id,
          },
          dedupeKey: `interview:completion-retried:${job.id}:${Date.now()}`,
          visibility: "internal",
        },
      ],
    });

    return { state: "ready" as const, job: resetJob };
  });
}

export async function loadCompletionData(input: {
  database: InterviewDatabase;
  interviewId: string;
}) {
  return input.database.transaction(async (transaction) => {
    const [interview] = await transaction
      .select()
      .from(interviews)
      .where(eq(interviews.id, input.interviewId))
      .limit(1);

    if (!interview) return null;

    const [snapshot] = await transaction
      .select()
      .from(interviewResumeSnapshots)
      .where(eq(interviewResumeSnapshots.interviewId, interview.id))
      .limit(1);

    const questions = await transaction
      .select({
        id: interviewQuestions.id,
        sequence: interviewQuestions.sequence,
        kind: interviewQuestions.kind,
        topic: interviewQuestions.topic,
        question: interviewQuestions.question,
        tip: interviewQuestions.tip,
        status: interviewQuestions.status,
        answerId: interviewAnswers.id,
        answerContent: interviewAnswers.content,
        answerStatus: interviewAnswers.status,
        scoreId: questionScores.id,
        understanding: questionScores.understanding,
        expression: questionScores.expression,
        logic: questionScores.logic,
        depth: questionScores.depth,
        authenticity: questionScores.authenticity,
        reflection: questionScores.reflection,
        overall: questionScores.overall,
        feedbackJson: questionScores.feedbackJson,
        scoreStatus: questionScores.status,
      })
      .from(interviewQuestions)
      .leftJoin(interviewAnswers, eq(interviewAnswers.questionId, interviewQuestions.id))
      .leftJoin(questionScores, eq(questionScores.questionId, interviewQuestions.id))
      .where(eq(interviewQuestions.interviewId, interview.id))
      .orderBy(asc(interviewQuestions.sequence));

    return {
      interview,
      snapshot,
      questions,
    };
  });
}

export async function loadInterviewReportData(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
}) {
  return input.database.transaction(async (transaction) => {
    const [interview] = await transaction
      .select({
        id: interviews.id,
        userId: interviews.userId,
        status: interviews.status,
        language: interviews.language,
        persona: interviews.persona,
        interviewType: interviews.interviewType,
        targetLevel: interviews.targetLevel,
        targetRole: interviews.targetRole,
        targetRoundCount: interviews.targetRoundCount,
        answeredRoundCount: interviews.answeredRoundCount,
        startedAt: interviews.startedAt,
        completedAt: interviews.completedAt,
        createdAt: interviews.createdAt,
      })
      .from(interviews)
      .where(and(eq(interviews.id, input.interviewId), eq(interviews.userId, input.userId)))
      .limit(1);

    if (!interview) return null;

    const [job] = await transaction
      .select({
        id: interviewCompletionJobs.id,
        status: interviewCompletionJobs.status,
      })
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, interview.id))
      .limit(1);

    const [report] = await transaction
      .select({
        id: interviewReports.id,
        overallScore: interviewReports.overallScore,
        dimensionAveragesJson: interviewReports.dimensionAveragesJson,
        summaryJson: interviewReports.summaryJson,
        scoreStatus: interviewReports.scoreStatus,
        generatedAt: interviewReports.generatedAt,
      })
      .from(interviewReports)
      .where(eq(interviewReports.interviewId, interview.id))
      .limit(1);

    const questions = await transaction
      .select({
        id: interviewQuestions.id,
        sequence: interviewQuestions.sequence,
        kind: interviewQuestions.kind,
        topic: interviewQuestions.topic,
        question: interviewQuestions.question,
        tip: interviewQuestions.tip,
        status: interviewQuestions.status,
        answerId: interviewAnswers.id,
        answerContent: interviewAnswers.content,
        answerStatus: interviewAnswers.status,
        understanding: questionScores.understanding,
        expression: questionScores.expression,
        logic: questionScores.logic,
        depth: questionScores.depth,
        authenticity: questionScores.authenticity,
        reflection: questionScores.reflection,
        overall: questionScores.overall,
        feedbackJson: questionScores.feedbackJson,
        scoreStatus: questionScores.status,
      })
      .from(interviewQuestions)
      .leftJoin(interviewAnswers, eq(interviewAnswers.questionId, interviewQuestions.id))
      .leftJoin(questionScores, eq(questionScores.questionId, interviewQuestions.id))
      .where(eq(interviewQuestions.interviewId, interview.id))
      .orderBy(asc(interviewQuestions.sequence));

    let validatedReport: {
      id: string;
      overallScore: number | null;
      dimensionAveragesJson: DimensionAverages | null;
      summaryJson: ReportSummary;
      scoreStatus: "scored" | "no_scorable_answers";
      generatedAt: Date;
    } | null = null;

    if (report) {
      const parsedSummary = reportSummarySchema.safeParse(report.summaryJson);
      const summaryJson: ReportSummary = parsedSummary.success
        ? parsedSummary.data
        : {
            overallSummary: "Historical report summary is unavailable.",
            keyStrengths: ["Historical strengths summary is unavailable."],
            keyImprovements: ["Historical improvement summary is unavailable."],
            recommendations: "Regenerate the interview report to obtain a complete assessment.",
          };

      if (report.scoreStatus === "scored") {
        if (
          typeof report.overallScore !== "number" ||
          report.overallScore < 0 ||
          report.overallScore > 100 ||
          !Number.isInteger(report.overallScore)
        ) {
          throw new InterviewApplicationError("INVALID_REPORT_DATA", "Interview report overall score is corrupted");
        }
        const parsedDims = dimensionAveragesSchema.safeParse(report.dimensionAveragesJson);
        if (!parsedDims.success) {
          throw new InterviewApplicationError("INVALID_REPORT_DATA", "Interview report dimension averages are corrupted");
        }
        validatedReport = {
          id: report.id,
          overallScore: report.overallScore,
          dimensionAveragesJson: parsedDims.data,
          summaryJson,
          scoreStatus: "scored",
          generatedAt: report.generatedAt,
        };
      } else if (report.scoreStatus === "no_scorable_answers") {
        if (report.overallScore !== null || report.dimensionAveragesJson !== null) {
          throw new InterviewApplicationError("INVALID_REPORT_DATA", "Interview report score data is corrupted");
        }
        validatedReport = {
          id: report.id,
          overallScore: null,
          dimensionAveragesJson: null,
          summaryJson,
          scoreStatus: "no_scorable_answers",
          generatedAt: report.generatedAt,
        };
      } else {
        throw new InterviewApplicationError("INVALID_REPORT_DATA", "Interview report score status is invalid");
      }
    }

    // Validate questions if scored
    const validatedQuestions: {
      id: string;
      sequence: number;
      kind: "main" | "follow_up";
      topic: string;
      question: string;
      tip: string | null;
      status: string;
      answerId: string | null;
      answerContent: string | null;
      answerStatus: string | null;
      understanding: number | null;
      expression: number | null;
      logic: number | null;
      depth: number | null;
      authenticity: number | null;
      reflection: number | null;
      overall: string | null;
      feedbackJson: unknown;
      scoreStatus: string | null;
    }[] = [];

    for (const q of questions) {
      if (q.scoreStatus === "scored") {
        const scoresObj = {
          understanding: q.understanding,
          expression: q.expression,
          logic: q.logic,
          depth: q.depth,
          authenticity: q.authenticity,
          reflection: q.reflection,
        };
        const parsedScores = questionScoresSchema.safeParse(scoresObj);
        if (!parsedScores.success) {
          throw new InterviewApplicationError("INVALID_REPORT_DATA", "Question score dimensions are corrupted");
        }
        const parsedFeedback = questionFeedbackSchema.safeParse(q.feedbackJson);
        if (!parsedFeedback.success) {
          throw new InterviewApplicationError("INVALID_REPORT_DATA", "Question feedback is corrupted");
        }
        const overallValidation = validateQuestionOverall(q.overall, parsedScores.data);
        if (!overallValidation.valid) {
          throw new InterviewApplicationError("INVALID_REPORT_DATA", "Question overall score is corrupted");
        }
        validatedQuestions.push({
          id: q.id,
          sequence: q.sequence,
          kind: q.kind as "main" | "follow_up",
          topic: q.topic,
          question: q.question,
          tip: q.tip,
          status: q.status,
          answerId: q.answerId,
          answerContent: q.answerContent,
          answerStatus: q.answerStatus,
          understanding: parsedScores.data.understanding,
          expression: parsedScores.data.expression,
          logic: parsedScores.data.logic,
          depth: parsedScores.data.depth,
          authenticity: parsedScores.data.authenticity,
          reflection: parsedScores.data.reflection,
          overall: overallValidation.overall.toFixed(1),
          feedbackJson: parsedFeedback.data,
          scoreStatus: "scored",
        });
      } else {
        if (
          q.scoreStatus !== "pending" &&
          q.scoreStatus !== "scoring" &&
          q.scoreStatus !== "failed" &&
          q.scoreStatus !== null
        ) {
          throw new InterviewApplicationError("INVALID_REPORT_DATA", "Unknown question score status");
        }
        validatedQuestions.push({
          id: q.id,
          sequence: q.sequence,
          kind: q.kind as "main" | "follow_up",
          topic: q.topic,
          question: q.question,
          tip: q.tip,
          status: q.status,
          answerId: q.answerId,
          answerContent: q.answerContent,
          answerStatus: q.answerStatus,
          understanding: null,
          expression: null,
          logic: null,
          depth: null,
          authenticity: null,
          reflection: null,
          overall: null,
          feedbackJson: null,
          scoreStatus: q.scoreStatus ?? null,
        });
      }
    }

    return {
      interview,
      job: job ?? null,
      report: validatedReport,
      questions: validatedQuestions,
    };
  });
}

export async function claimNextAvailableCompletionJob(input: {
  database: InterviewDatabase;
}): Promise<{
  found: boolean;
  job?: {
    id: string;
    interviewId: string;
    userId: string;
  };
}> {
  return input.database.transaction(async (tx) => {
    const now = new Date();
    const candidateJobs = await tx
      .select({
        id: interviewCompletionJobs.id,
        interviewId: interviewCompletionJobs.interviewId,
        status: interviewCompletionJobs.status,
        userId: interviews.userId,
      })
      .from(interviewCompletionJobs)
      .innerJoin(interviews, eq(interviews.id, interviewCompletionJobs.interviewId))
      .where(
        or(
          eq(interviewCompletionJobs.status, "pending"),
          and(
            inArray(interviewCompletionJobs.status, ["scoring", "reporting"]),
            isNotNull(interviewCompletionJobs.claimExpiresAt),
            lt(interviewCompletionJobs.claimExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(interviewCompletionJobs.createdAt), asc(interviewCompletionJobs.id))
      .limit(1)
      .for("update", { skipLocked: true });

    const candidate = candidateJobs[0];
    if (!candidate) {
      return { found: false };
    }

    return {
      found: true,
      job: {
        id: candidate.id,
        interviewId: candidate.interviewId,
        userId: candidate.userId,
      },
    };
  });
}

