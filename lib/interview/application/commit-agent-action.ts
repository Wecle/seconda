import { and, asc, eq } from "drizzle-orm";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import {
  agentRuns,
  agentSessions,
  agentEvents,
  interviewAgentRuns,
  interviewAnswers,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
} from "@/lib/db/schema";
import { assertOpeningAction, submitInterviewActionSchema, type SubmitInterviewAction } from "../agent/action";
import { ensureCompletionJobInTransaction } from "../persistence/completion-repository";
import type { InterviewDatabase } from "../persistence/repository";

async function settleCommittedInterviewAttempt(
  transaction: Parameters<Parameters<InterviewDatabase["transaction"]>[0]>[0],
  input: { agentRunId: string; sessionId: string; committedAt: Date },
) {
  const [agentRun] = await transaction.update(agentRuns).set({
    status: "completed",
    completedAt: input.committedAt,
  }).where(and(
    eq(agentRuns.id, input.agentRunId),
    eq(agentRuns.sessionId, input.sessionId),
    eq(agentRuns.status, "running"),
  )).returning({ id: agentRuns.id });
  if (!agentRun) throw new Error("Interview Agent attempt could not be completed atomically");
  const [session] = await transaction.update(agentSessions).set({
    status: "idle",
    updatedAt: input.committedAt,
  }).where(and(
    eq(agentSessions.id, input.sessionId),
    eq(agentSessions.status, "running"),
  )).returning({ id: agentSessions.id });
  if (!session) throw new Error("Interview Agent session could not be completed atomically");
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function caseFoldText(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replaceAll("ς", "σ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

function normalizedQuestionKey(value: string) {
  return caseFoldText(value).replace(/[\p{P}\p{S}\s]+/gu, "");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function assertCommittedQuestionReplay(input: {
  proposal: SubmitInterviewAction;
  question: typeof interviewQuestions.$inferSelect;
  answerAnalysis: unknown;
}) {
  if (input.proposal.action.type !== "ask_question") {
    throw new Error("Completed interview action replay does not match the committed question");
  }
  const proposalTip = input.proposal.action.tip ? normalizeText(input.proposal.action.tip) : null;
  const matchesQuestion = input.proposal.action.kind === input.question.kind
    && normalizeText(input.proposal.action.question) === input.question.question
    && normalizeText(input.proposal.action.topic) === input.question.topic
    && proposalTip === input.question.tip
    && canonicalJson(input.proposal.action.resumeEvidenceIds) === canonicalJson(input.question.resumeEvidenceIds);
  const matchesAnalysis = canonicalJson(input.proposal.answerAnalysis) === canonicalJson(input.answerAnalysis);
  if (!matchesQuestion || !matchesAnalysis) {
    throw new Error("Completed interview action replay does not match the committed question");
  }
}

function assertTurnProposal(input: {
  triggerType: string;
  proposal: SubmitInterviewAction;
  answeredRoundCount: number;
  targetRoundCount: number;
  previousQuestion: typeof interviewQuestions.$inferSelect | null;
}) {
  if (input.triggerType === "opening") {
    assertOpeningAction(input.proposal);
    return;
  }
  if (input.triggerType === "answer" && input.proposal.answerAnalysis === null) {
    throw new Error("Answer action must include answer analysis");
  }
  if (input.triggerType === "skip" && input.proposal.answerAnalysis !== null) {
    throw new Error("Skip action must not include answer analysis");
  }
  const reachedTarget = input.answeredRoundCount >= input.targetRoundCount;
  if (reachedTarget && input.proposal.action.type !== "complete_interview") {
    throw new Error("Interview must complete after reaching the target round count");
  }
  if (!reachedTarget && input.proposal.action.type === "complete_interview") {
    throw new Error("Interview cannot complete before reaching the target round count");
  }
  if (input.proposal.action.type === "ask_question" && input.proposal.action.kind === "follow_up") {
    if (input.triggerType !== "answer" || !input.previousQuestion || input.previousQuestion.kind === "follow_up") {
      throw new Error("A follow-up is not authorized for this turn");
    }
    if (caseFoldText(input.proposal.action.topic) !== caseFoldText(input.previousQuestion.topic)) {
      throw new Error("A follow-up must stay on the current topic");
    }
  }
  if (input.triggerType === "skip"
    && input.proposal.action.type === "ask_question"
    && input.proposal.action.kind !== "main") {
    throw new Error("A skipped answer must move to a main question");
  }
  if (input.previousQuestion?.kind === "follow_up"
    && input.proposal.action.type === "ask_question"
    && input.proposal.action.kind === "main"
    && caseFoldText(input.proposal.action.topic) === caseFoldText(input.previousQuestion.topic)) {
    throw new Error("A follow-up must be followed by a different topic");
  }
}

export async function commitInterviewAgentAction(input: {
  userId: string;
  sessionId: string;
  agentRunId: string;
  interviewId: string;
  interviewRunId: string;
  attemptGeneration: number;
  leaseOwner: string;
  action: unknown;
}, dependencies: { database?: InterviewDatabase } = {}) {
  const proposal = submitInterviewActionSchema.parse(input.action);
  let database = dependencies.database;
  if (!database) {
    const { db } = await import("@/lib/db");
    database = db;
  }

  return database.transaction(async (transaction) => {
    const [interview] = await transaction.select().from(interviews)
      .where(and(eq(interviews.id, input.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");
    if (!interview || interview.agentSessionId !== input.sessionId) {
      throw new Error("Interview ownership mismatch");
    }
    const [logicalRun] = await transaction.select().from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, input.interviewRunId))
      .limit(1)
      .for("update");
    if (!logicalRun
      || logicalRun.interviewId !== interview.id
      || logicalRun.currentAgentRunId !== input.agentRunId
      || logicalRun.attemptGeneration !== input.attemptGeneration) {
      throw new Error("Interview run identity mismatch");
    }
    const [existing] = await transaction.select().from(interviewQuestions)
      .where(and(
        eq(interviewQuestions.sourceInterviewRunId, input.interviewRunId),
        eq(interviewQuestions.interviewId, interview.id),
      ))
      .limit(1);
    if (logicalRun.status === "completed") {
      if (existing) {
        const [committedAnswer] = logicalRun.triggerAnswerId
          ? await transaction.select({ analysisJson: interviewAnswers.analysisJson })
              .from(interviewAnswers)
              .where(and(
                eq(interviewAnswers.id, logicalRun.triggerAnswerId),
                eq(interviewAnswers.interviewId, interview.id),
              ))
              .limit(1)
          : [];
        assertCommittedQuestionReplay({
          proposal,
          question: existing,
          answerAnalysis: committedAnswer?.analysisJson ?? null,
        });
        return existing;
      }
      if (proposal.action.type === "complete_interview"
        && (interview.status === "completing" || interview.status === "completed")) {
        const [completionEvent] = await transaction.select({ payload: agentEvents.payload })
          .from(agentEvents)
          .where(and(
            eq(agentEvents.sessionId, input.sessionId),
            eq(agentEvents.runId, input.agentRunId),
            eq(agentEvents.type, "interview/completion_requested"),
          ))
          .limit(1);
        const payload = completionEvent?.payload;
        const committedClosingMessage = payload && typeof payload === "object" && "closingMessage" in payload
          ? payload.closingMessage
          : null;
        if (committedClosingMessage !== normalizeText(proposal.action.closingMessage)) {
          throw new Error("Completed interview action replay does not match the committed action");
        }
        return { id: interview.id, completed: true as const };
      }
      throw new Error("Completed interview action replay does not match the committed action");
    }
    const [agentRun] = await transaction.select({
      id: agentRuns.id,
      status: agentRuns.status,
      capability: agentSessions.capability,
    }).from(agentRuns)
      .innerJoin(agentSessions, eq(agentRuns.sessionId, agentSessions.id))
      .where(and(
        eq(agentRuns.id, input.agentRunId),
        eq(agentRuns.sessionId, input.sessionId),
        eq(agentSessions.userId, input.userId),
      ))
      .limit(1);
    if (
      logicalRun.status !== "running"
      || logicalRun.leaseOwner !== input.leaseOwner
      || !logicalRun.leaseExpiresAt
      || logicalRun.leaseExpiresAt <= new Date()
      || agentRun?.status !== "running"
      || agentRun.capability !== "interview"
    ) {
      throw new Error("Interview run is not authorized to commit");
    }
    const [triggerAnswer] = logicalRun.triggerAnswerId
      ? await transaction.select().from(interviewAnswers)
          .where(and(
            eq(interviewAnswers.id, logicalRun.triggerAnswerId),
            eq(interviewAnswers.interviewId, interview.id),
          ))
          .limit(1)
      : [];
    const [previousQuestion] = triggerAnswer
      ? await transaction.select().from(interviewQuestions)
          .where(and(
            eq(interviewQuestions.id, triggerAnswer.questionId),
            eq(interviewQuestions.interviewId, interview.id),
          ))
          .limit(1)
      : [];
    if (logicalRun.triggerType === "opening") {
      if (interview.status !== "initializing" || triggerAnswer || previousQuestion) {
        throw new Error("Opening run is not authorized to commit");
      }
    } else if (interview.status !== "active" || !triggerAnswer || !previousQuestion) {
      throw new Error("Interview turn is not authorized to commit");
    }
    assertTurnProposal({
      triggerType: logicalRun.triggerType,
      proposal,
      answeredRoundCount: interview.answeredRoundCount,
      targetRoundCount: interview.targetRoundCount,
      previousQuestion: previousQuestion ?? null,
    });

    const committedAt = new Date();
    const analysisEvents = proposal.answerAnalysis && triggerAnswer
      ? [{
          type: "interview/answer_analyzed" as const,
          payload: {
            interviewId: interview.id,
            answerId: triggerAnswer.id,
            analysis: proposal.answerAnalysis,
          },
          dedupeKey: `interview:analysis:${triggerAnswer.id}`,
          visibility: "internal" as const,
        }]
      : [];
    if (proposal.answerAnalysis && triggerAnswer) {
      await transaction.update(interviewAnswers).set({
        analysisJson: proposal.answerAnalysis,
        analysisRunId: logicalRun.id,
      }).where(eq(interviewAnswers.id, triggerAnswer.id));
    }
    if (proposal.action.type === "complete_interview") {
      await transaction.update(interviews).set({
        status: "completing",
        version: interview.version + 1,
        updatedAt: committedAt,
      }).where(eq(interviews.id, interview.id));
      await ensureCompletionJobInTransaction(transaction, interview.id);
      await transaction.update(interviewAgentRuns).set({
        status: "completed",
        completedAt: committedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorJson: null,
      }).where(eq(interviewAgentRuns.id, logicalRun.id));
      await settleCommittedInterviewAttempt(transaction, {
        agentRunId: input.agentRunId,
        sessionId: input.sessionId,
        committedAt,
      });
      await appendAgentEventsInTransaction(transaction, {
        sessionId: input.sessionId,
        runId: input.agentRunId,
        events: [
          ...analysisEvents,
          {
            type: "interview/completion_requested",
            payload: {
              interviewId: interview.id,
              closingMessage: normalizeText(proposal.action.closingMessage),
            },
            dedupeKey: `interview:completion-requested:${interview.id}`,
            visibility: "model_and_user",
          },
          {
            type: "run_completed",
            payload: { domainCommitted: true },
            dedupeKey: `interview:attempt-completed:${logicalRun.id}:${logicalRun.attemptGeneration}`,
            visibility: "model",
          },
        ],
      });
      return { id: interview.id, completed: true as const };
    }
    const [snapshot] = await transaction.select({ evidenceJson: interviewResumeSnapshots.evidenceJson })
      .from(interviewResumeSnapshots)
      .where(eq(interviewResumeSnapshots.interviewId, interview.id))
      .limit(1);
    if (!snapshot) throw new Error("Interview resume snapshot is missing");
    const evidence = snapshot.evidenceJson as Record<string, unknown>;
    if (proposal.action.resumeEvidenceIds.some((id) => !(id in evidence))) {
      throw new Error("Question references unknown resume evidence");
    }
    const questionText = normalizeText(proposal.action.question);
    const topic = normalizeText(proposal.action.topic);
    const tip = proposal.action.tip ? normalizeText(proposal.action.tip) : null;
    if (!questionText || !topic) throw new Error("Question and topic must not be empty");
    const history = await transaction.select({ question: interviewQuestions.question })
      .from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, interview.id))
      .orderBy(asc(interviewQuestions.sequence));
    const questionKey = normalizedQuestionKey(questionText);
    if (history.some((item) => normalizedQuestionKey(item.question) === questionKey)) {
      throw new Error("Interview question duplicates a previous question");
    }
    const [awaitingQuestion] = await transaction.select({ id: interviewQuestions.id })
      .from(interviewQuestions)
      .where(and(
        eq(interviewQuestions.interviewId, interview.id),
        eq(interviewQuestions.status, "awaiting_answer"),
      ))
      .limit(1);
    if (awaitingQuestion) throw new Error("Interview already has a question awaiting an answer");
    const [question] = await transaction.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: logicalRun.id,
      sequence: logicalRun.triggerType === "opening" ? 1 : interview.answeredRoundCount + 1,
      kind: proposal.action.kind,
      topic,
      question: questionText,
      tip,
      resumeEvidenceIds: proposal.action.resumeEvidenceIds,
    }).returning();
    await transaction.update(interviews).set({
      status: logicalRun.triggerType === "opening" ? "active" : interview.status,
      version: interview.version + 1,
      startedAt: interview.startedAt ?? committedAt,
      updatedAt: committedAt,
    }).where(eq(interviews.id, interview.id));
    await transaction.update(interviewAgentRuns).set({
      status: "completed",
      completedAt: committedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorJson: null,
    }).where(eq(interviewAgentRuns.id, logicalRun.id));
    await settleCommittedInterviewAttempt(transaction, {
      agentRunId: input.agentRunId,
      sessionId: input.sessionId,
      committedAt,
    });
    await appendAgentEventsInTransaction(transaction, {
      sessionId: input.sessionId,
      runId: input.agentRunId,
      events: [
        ...analysisEvents,
        {
          type: "interview/question_committed",
          payload: {
            interviewId: interview.id,
            questionId: question.id,
            sequence: question.sequence,
            kind: question.kind,
            topic: question.topic,
            question: question.question,
            tip: question.tip,
            resumeEvidenceIds: question.resumeEvidenceIds,
          },
          dedupeKey: `interview:question:${question.id}`,
          visibility: "model_and_user",
        },
        {
          type: "run_completed",
          payload: { domainCommitted: true },
          dedupeKey: `interview:attempt-completed:${logicalRun.id}:${logicalRun.attemptGeneration}`,
          visibility: "model",
        },
      ],
    });
    return question;
  });
}
