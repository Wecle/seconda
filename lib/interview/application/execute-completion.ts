import { generateStructured as defaultGenerateStructured } from "@/lib/ai/generate-structured";
import {
  claimCompletionJob,
  claimNextQuestionScore,
  commitClaimedQuestionScore,
  commitCompletionReport,
  ensurePendingQuestionScoresInTransaction,
  failClaimedQuestionScore,
  failCompletionJob,
  loadCompletionData,
  renewCompletionClaim,
  renewQuestionScoreClaim,
  transitionJobToReporting,
} from "../persistence/completion-repository";
import {
  computeInterviewAggregates,
  computeQuestionOverall,
  questionEvaluationSchema,
  reportSummarySchema,
  type QuestionScores,
  type ScoredQuestionInput,
} from "../domain/scoring";
import {
  buildQuestionScoringPrompt,
  buildReportGenerationPrompt,
  QUESTION_SCORING_PROMPT_VERSION,
  QUESTION_SCORING_SYSTEM_PROMPT,
  REPORT_GENERATION_PROMPT_VERSION,
  REPORT_GENERATION_SYSTEM_PROMPT,
} from "../completion/prompt";
import type { InterviewDatabase } from "../persistence/repository";

export type ExecuteCompletionInput = {
  interviewId: string;
  userId: string;
  abortSignal?: AbortSignal;
};

export type ExecuteCompletionDependencies = {
  database?: InterviewDatabase;
  generateStructured?: typeof defaultGenerateStructured;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
};

export async function executeInterviewCompletion(
  input: ExecuteCompletionInput,
  dependencies: ExecuteCompletionDependencies = {},
) {
  const database = dependencies.database ?? (await import("@/lib/db")).db;
  const generate = dependencies.generateStructured ?? defaultGenerateStructured;
  const leaseDurationMs = dependencies.leaseDurationMs ?? 60_000;
  const heartbeatIntervalMs = dependencies.heartbeatIntervalMs ?? 15_000;

  const claimResult = await claimCompletionJob({
    database,
    userId: input.userId,
    interviewId: input.interviewId,
    leaseDurationMs,
  });

  if (claimResult.state === "not_found") {
    return { status: "not_found" as const };
  }
  if (claimResult.state === "completed") {
    return { status: "completed" as const, job: claimResult.job };
  }
  if (claimResult.state === "unavailable") {
    return { status: "unavailable" as const, jobStatus: claimResult.status };
  }
  if (claimResult.state === "invalid_state") {
    return { status: "invalid_state" as const, reason: "reason" in claimResult ? claimResult.reason : claimResult.status };
  }

  const { job, claimToken, interview } = claimResult;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let claimValid = true;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  heartbeatTimer = setInterval(() => {
    void renewCompletionClaim({
      database,
      jobId: job.id,
      claimToken,
      leaseDurationMs,
    }).then((renewed) => {
      if (!renewed) {
        claimValid = false;
        stopHeartbeat();
      }
    }).catch(() => {
      claimValid = false;
      stopHeartbeat();
    });
  }, heartbeatIntervalMs);

  try {
    // Ensure all scorable questions have pending score rows
    await database.transaction(async (tx) => {
      await ensurePendingQuestionScoresInTransaction(tx, interview.id);
    });

    const completionContext = await loadCompletionData({ database, interviewId: interview.id });
    if (!completionContext || !completionContext.snapshot) {
      throw new Error("Interview completion context is missing");
    }

    const { snapshot } = completionContext;

    // Score all pending/failed/expired scorable questions one by one
    let hasScoreFailure = false;

    while (claimValid && !input.abortSignal?.aborted) {
      const claimScoreResult = await claimNextQuestionScore({
        database,
        interviewId: interview.id,
        jobId: job.id,
        jobClaimToken: claimToken,
        leaseDurationMs,
      });

      if (claimScoreResult.state === "job_invalid") {
        claimValid = false;
        break;
      }

      if (claimScoreResult.state === "none_pending") {
        break;
      }

      const { scoreId, questionId, topic, question, answerContent, scoreClaimToken } = claimScoreResult;

      let scoreClaimActive = true;
      let scoreHeartbeat: NodeJS.Timeout | null = setInterval(() => {
        if (!scoreClaimActive) return;
        void renewQuestionScoreClaim({
          database,
          interviewId: interview.id,
          jobId: job.id,
          jobClaimToken: claimToken,
          scoreId,
          scoreClaimToken,
          leaseDurationMs,
        })
          .then((renewed) => {
            if (!renewed) {
              scoreClaimActive = false;
              if (scoreHeartbeat) {
                clearInterval(scoreHeartbeat);
                scoreHeartbeat = null;
              }
            }
          })
          .catch(() => {
            scoreClaimActive = false;
            if (scoreHeartbeat) {
              clearInterval(scoreHeartbeat);
              scoreHeartbeat = null;
            }
          });
      }, heartbeatIntervalMs);

      try {
        if (!scoreClaimActive || input.abortSignal?.aborted) {
          throw new Error("Question score claim lost or aborted before evaluation");
        }

        const scoringPrompt = buildQuestionScoringPrompt({
          targetRole: interview.targetRole,
          targetLevel: interview.targetLevel,
          questionTopic: topic,
          questionText: question,
          answerContent,
          resumeCanonicalText: snapshot.canonicalText,
        });

        const evaluation = await generate({
          task: "interview.question_scoring",
          schema: questionEvaluationSchema,
          system: QUESTION_SCORING_SYSTEM_PROMPT,
          prompt: scoringPrompt,
          abortSignal: input.abortSignal,
          telemetry: {
            operationKey: `interview:score:${questionId}:${job.attemptCount}`,
            budgetScope: `interview:${interview.id}`,
            promptTemplateVersion: QUESTION_SCORING_PROMPT_VERSION,
          },
        });

        if (!scoreClaimActive || input.abortSignal?.aborted) {
          throw new Error("Question score claim lost or aborted during evaluation");
        }

        const { questionOverall } = computeQuestionOverall(evaluation.scores);

        await commitClaimedQuestionScore({
          database,
          interviewId: interview.id,
          jobId: job.id,
          jobClaimToken: claimToken,
          scoreId,
          questionId,
          scoreClaimToken,
          evaluation,
          overall: questionOverall,
        });
      } catch (scoreError) {
        hasScoreFailure = true;
        await failClaimedQuestionScore({
          database,
          interviewId: interview.id,
          jobId: job.id,
          jobClaimToken: claimToken,
          scoreId,
          questionId,
          scoreClaimToken,
          error: scoreError,
        }).catch(() => {});
      } finally {
        if (scoreHeartbeat) {
          clearInterval(scoreHeartbeat);
          scoreHeartbeat = null;
        }
      }
    }

    if (!claimValid || input.abortSignal?.aborted) {
      throw new Error("Completion job claim lost or aborted");
    }

    if (hasScoreFailure) {
      throw new Error("One or more question evaluations failed");
    }

    // Check updated questions state
    const refreshedData = await loadCompletionData({ database, interviewId: interview.id });
    if (!refreshedData) {
      throw new Error("Failed to reload completion data");
    }

    const uncompletedQuestion = refreshedData.questions.find(
      (q) =>
        q.status === "answered" &&
        q.answerStatus === "answered" &&
        q.answerContent &&
        q.answerContent.trim().length > 0 &&
        q.scoreStatus !== "scored",
    );

    if (uncompletedQuestion) {
      throw new Error(`Question ${uncompletedQuestion.sequence} failed or was not scored`);
    }

    // Transition to reporting stage
    const transitioned = await transitionJobToReporting({ database, jobId: job.id, claimToken });
    if (!transitioned) {
      throw new Error("Failed to transition completion job to reporting status");
    }

    // Prepare inputs for summary generation
    const scoredInputs: ScoredQuestionInput[] = [];
    const questionReportDetails: Array<{
      sequence: number;
      topic: string;
      question: string;
      answer: string;
      skipped: boolean;
      scores?: QuestionScores;
      strengths?: string[];
      improvements?: string[];
      advice?: string;
    }> = [];

    for (const q of refreshedData.questions) {
      if (q.status === "skipped" || q.answerStatus === "skipped" || !q.answerContent || q.answerContent.trim().length === 0) {
        questionReportDetails.push({
          sequence: q.sequence,
          topic: q.topic,
          question: q.question,
          answer: "",
          skipped: true,
        });
        continue;
      }

      if (
        q.scoreStatus === "scored" &&
        q.understanding !== null &&
        q.expression !== null &&
        q.logic !== null &&
        q.depth !== null &&
        q.authenticity !== null &&
        q.reflection !== null
      ) {
        const scores: QuestionScores = {
          understanding: q.understanding,
          expression: q.expression,
          logic: q.logic,
          depth: q.depth,
          authenticity: q.authenticity,
          reflection: q.reflection,
        };
        const feedback = q.feedbackJson as { strengths?: string[]; improvements?: string[]; advice?: string } | null;

        scoredInputs.push({ questionId: q.id, scores });
        questionReportDetails.push({
          sequence: q.sequence,
          topic: q.topic,
          question: q.question,
          answer: q.answerContent,
          skipped: false,
          scores,
          strengths: feedback?.strengths,
          improvements: feedback?.improvements,
          advice: feedback?.advice,
        });
      }
    }

    const aggregates = computeInterviewAggregates(scoredInputs);

    // Generate summary
    const reportPrompt = buildReportGenerationPrompt({
      targetRole: interview.targetRole,
      targetLevel: interview.targetLevel,
      interviewType: interview.interviewType,
      overallScore: aggregates.overallScore,
      scoreStatus: aggregates.scoreStatus,
      dimensionAverages: aggregates.dimensionAverages,
      questions: questionReportDetails,
      resumeCanonicalText: snapshot.canonicalText,
    });

    const summary = await generate({
      task: "interview.report_generation",
      schema: reportSummarySchema,
      system: REPORT_GENERATION_SYSTEM_PROMPT,
      prompt: reportPrompt,
      abortSignal: input.abortSignal,
      telemetry: {
        operationKey: `interview:report:${interview.id}:${job.attemptCount}`,
        budgetScope: `interview:${interview.id}`,
        promptTemplateVersion: REPORT_GENERATION_PROMPT_VERSION,
      },
    });

    // Commit report atomically and deterministically in transaction
    const report = await commitCompletionReport({
      database,
      userId: input.userId,
      interviewId: interview.id,
      jobId: job.id,
      claimToken,
      summary,
    });

    stopHeartbeat();
    return { status: "completed" as const, report };
  } catch (error) {
    stopHeartbeat();
    await failCompletionJob({
      database,
      jobId: job.id,
      claimToken,
      error,
    }).catch(() => {});
    return { status: "failed" as const, error };
  }
}
