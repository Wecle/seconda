import { and, eq, inArray } from "drizzle-orm";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import {
  agentRuns,
  agentSessions,
  interviewAgentRuns,
  interviewAnswers,
  interviewQuestions,
  interviews,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import {
  answerSubmissionKeySchema,
  answerSubmissionRequestHash,
  submitInterviewAnswerRequestSchema,
} from "../domain/submit-answer";
import { InterviewApplicationError } from "../domain/errors";
import type { InterviewDatabase } from "../persistence/repository";

export async function submitInterviewAnswer(input: {
  userId: string;
  interviewId: string;
  idempotencyKey: string;
  request: unknown;
}, dependencies: { database?: InterviewDatabase } = {}) {
  const request = submitInterviewAnswerRequestSchema.parse(input.request);
  const submissionKey = answerSubmissionKeySchema.parse(input.idempotencyKey);
  const requestHash = answerSubmissionRequestHash(request);
  const database = dependencies.database ?? db;

  return database.transaction(async (transaction) => {
    const [interview] = await transaction.select().from(interviews)
      .where(and(eq(interviews.id, input.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");
    if (!interview) {
      throw new InterviewApplicationError("INTERVIEW_NOT_FOUND", "Interview not found");
    }
    const [session] = await transaction.select({ id: agentSessions.id }).from(agentSessions)
      .where(and(
        eq(agentSessions.id, interview.agentSessionId),
        eq(agentSessions.userId, input.userId),
        eq(agentSessions.capability, "interview"),
      ))
      .limit(1)
      .for("update");
    if (!session) {
      throw new InterviewApplicationError("INTERVIEW_NOT_FOUND", "Interview not found");
    }

    const [replayedAnswer] = await transaction.select().from(interviewAnswers)
      .where(and(
        eq(interviewAnswers.interviewId, interview.id),
        eq(interviewAnswers.submissionKey, submissionKey),
      ))
      .limit(1);
    if (replayedAnswer) {
      if (replayedAnswer.submissionRequestHash !== requestHash) {
        throw new InterviewApplicationError(
          "INTERVIEW_SUBMISSION_CONFLICT",
          "The idempotency key was already used for a different answer",
        );
      }
      const [replayedRun] = await transaction.select().from(interviewAgentRuns)
        .where(eq(interviewAgentRuns.triggerAnswerId, replayedAnswer.id))
        .limit(1);
      if (!replayedRun) throw new Error("Answer replay is missing its Agent run");
      return { answer: replayedAnswer, run: replayedRun, replayed: true as const };
    }

    const [activeTurn] = await transaction.select({ id: interviewAgentRuns.id })
      .from(interviewAgentRuns)
      .where(and(
        eq(interviewAgentRuns.interviewId, interview.id),
        inArray(interviewAgentRuns.triggerType, ["answer", "skip"]),
        inArray(interviewAgentRuns.status, ["queued", "running"]),
      ))
      .limit(1);
    if (activeTurn) {
      throw new InterviewApplicationError(
        "INTERVIEW_INVALID_STATE",
        "Interview is already evaluating an answer",
      );
    }
    const [activeAgentRun] = await transaction.select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.sessionId, session.id),
        inArray(agentRuns.status, ["queued", "running"]),
      ))
      .limit(1);
    if (activeAgentRun) {
      throw new InterviewApplicationError(
        "INTERVIEW_INVALID_STATE",
        "Interview Agent is still settling the previous turn",
      );
    }

    const [question] = await transaction.select().from(interviewQuestions)
      .where(and(
        eq(interviewQuestions.id, request.questionId),
        eq(interviewQuestions.interviewId, interview.id),
      ))
      .limit(1)
      .for("update");
    const [existingQuestionAnswer] = question
      ? await transaction.select().from(interviewAnswers)
          .where(eq(interviewAnswers.questionId, question.id))
          .limit(1)
      : [];
    if (existingQuestionAnswer) {
      throw new InterviewApplicationError(
        "INTERVIEW_SUBMISSION_CONFLICT",
        "This question already has an answer",
      );
    }
    if (interview.status !== "active" || !question || question.status !== "awaiting_answer") {
      throw new InterviewApplicationError("INTERVIEW_INVALID_STATE", "Interview is not accepting this answer");
    }

    const status = request.skipped ? "skipped" as const : "answered" as const;
    const content = request.skipped ? "" : request.content!.normalize("NFKC").trim();
    const [answer] = await transaction.insert(interviewAnswers).values({
      interviewId: interview.id,
      questionId: question.id,
      submissionKey,
      submissionRequestHash: requestHash,
      content,
      status,
    }).returning();
    const [agentRun] = await transaction.insert(agentRuns).values({
      sessionId: interview.agentSessionId,
      status: "queued",
      maxSteps: 10,
    }).returning();
    const [logicalRun] = await transaction.insert(interviewAgentRuns).values({
      interviewId: interview.id,
      currentAgentRunId: agentRun.id,
      triggerType: request.skipped ? "skip" : "answer",
      triggerKey: `answer:${answer.id}`,
      triggerAnswerId: answer.id,
      status: "queued",
    }).returning();
    const submittedAt = answer.submittedAt;
    await transaction.update(interviewQuestions).set({
      status,
      closedAt: submittedAt,
    }).where(eq(interviewQuestions.id, question.id));
    await transaction.update(interviews).set({
      answeredRoundCount: interview.answeredRoundCount + 1,
      version: interview.version + 1,
      updatedAt: submittedAt,
    }).where(eq(interviews.id, interview.id));
    await appendAgentEventsInTransaction(transaction, {
      sessionId: interview.agentSessionId,
      runId: agentRun.id,
      events: [{
        type: "interview/answer_submitted",
        payload: {
          interviewId: interview.id,
          answerId: answer.id,
          questionId: question.id,
          sequence: question.sequence,
          content: answer.content,
          skipped: request.skipped,
        },
        dedupeKey: `interview:answer:${answer.id}`,
        visibility: "model_and_user",
      }],
    });
    return { answer, run: logicalRun, replayed: false as const };
  });
}
