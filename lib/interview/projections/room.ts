import type {
  InterviewCompletionJobSnapshot,
  InterviewQuestionSnapshot,
  InterviewRoomPhase,
  InterviewRoomView,
  InterviewRunSnapshot,
  InterviewSnapshot,
} from "./types";

function resolveRoomPhase(input: {
  interview: InterviewSnapshot;
  currentQuestion: InterviewQuestionSnapshot | null;
  currentRun: InterviewRunSnapshot | null;
  completionJob?: InterviewCompletionJobSnapshot | null;
}): InterviewRoomPhase {
  const { interview, currentQuestion, currentRun } = input;
  const currentAttemptActive = currentRun?.agentRunStatus === "queued" || currentRun?.agentRunStatus === "running";
  if (interview.status === "completed") return "completed";
  if (interview.status === "completing") return "completing";
  if (currentRun?.status === "failed") return "run_failed";
  if (
    interview.status === "initializing"
    && currentRun?.triggerType === "opening"
    && (currentRun.status === "queued" || currentRun.status === "running" || currentAttemptActive)
  ) {
    return "generating_question";
  }
  if (
    interview.status === "active"
    && currentRun
    && (currentRun.triggerType === "answer" || currentRun.triggerType === "skip")
    && (currentRun.status === "queued" || currentRun.status === "running" || currentAttemptActive)
  ) {
    return "evaluating_answer";
  }
  if (
    interview.status === "active"
    && currentQuestion?.status === "awaiting_answer"
    && currentRun?.status !== "queued"
    && currentRun?.status !== "running"
    && !currentAttemptActive
  ) {
    return "awaiting_answer";
  }
  if (interview.status === "initializing" && currentRun === null) {
    return "initializing";
  }
  return "invalid_state";
}

export function projectInterviewRoom(input: {
  interview: InterviewSnapshot;
  currentQuestion: InterviewQuestionSnapshot | null;
  currentRun: InterviewRunSnapshot | null;
  completionJob?: InterviewCompletionJobSnapshot | null;
}): InterviewRoomView {
  const phase = resolveRoomPhase(input);
  const currentRound = input.currentQuestion?.sequence
    ?? Math.min(input.interview.answeredRoundCount + 1, input.interview.targetRoundCount);
  const awaitingAnswer = phase === "awaiting_answer";

  return {
    interviewId: input.interview.id,
    phase,
    currentQuestion: input.currentQuestion
      ? {
          id: input.currentQuestion.id,
          sequence: input.currentQuestion.sequence,
          kind: input.currentQuestion.kind,
          topic: input.currentQuestion.topic,
          content: input.currentQuestion.question,
          tip: input.currentQuestion.tip,
          resumeEvidenceIds: input.currentQuestion.resumeEvidenceIds ?? [],
        }
      : null,
    currentRound,
    totalRounds: input.interview.targetRoundCount,
    canSubmitAnswer: awaitingAnswer,
    canSkip: awaitingAnswer,
    canEnd: input.interview.status === "active" && phase !== "invalid_state",
    retryableRunId: phase === "run_failed" ? input.currentRun?.id ?? null : null,
    canRetryCompletion: input.interview.status === "completing" && input.completionJob?.status === "failed",
    resumeTitle: input.interview.resumeTitle ?? null,
  };
}
