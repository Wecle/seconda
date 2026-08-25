import { and, eq } from "drizzle-orm";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import {
  agentRuns,
  agentSessions,
  interviewAgentRuns,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
} from "@/lib/db/schema";
import { assertOpeningAction, submitInterviewActionSchema } from "../agent/action";
import type { InterviewDatabase } from "../persistence/repository";
import { db } from "@/lib/db";

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export async function commitInterviewAgentAction(input: {
  userId: string;
  sessionId: string;
  agentRunId: string;
  interviewId: string;
  interviewRunId: string;
  attemptGeneration: number;
  action: unknown;
}, dependencies: { database?: InterviewDatabase } = {}) {
  const proposal = submitInterviewActionSchema.parse(input.action);
  assertOpeningAction(proposal);
  const database = dependencies.database ?? db;

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
    if (
      !logicalRun
      || logicalRun.interviewId !== interview.id
      || logicalRun.triggerType !== "opening"
      || logicalRun.currentAgentRunId !== input.agentRunId
      || logicalRun.attemptGeneration !== input.attemptGeneration
    ) {
      throw new Error("Opening run identity mismatch");
    }
    const [existing] = await transaction.select().from(interviewQuestions)
      .where(and(
        eq(interviewQuestions.sourceInterviewRunId, input.interviewRunId),
        eq(interviewQuestions.interviewId, interview.id),
      ))
      .limit(1);
    if (existing && logicalRun.status === "completed") return existing;
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
      interview.status !== "initializing"
      || logicalRun.status !== "running"
      || agentRun?.status !== "running"
      || agentRun.capability !== "interview"
    ) {
      throw new Error("Opening run is not authorized to commit");
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
    const [question] = await transaction.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: logicalRun.id,
      sequence: 1,
      kind: "main",
      topic,
      question: questionText,
      tip,
      resumeEvidenceIds: proposal.action.resumeEvidenceIds,
    }).returning();
    const committedAt = new Date();
    await transaction.update(interviews).set({
      status: "active",
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
    await appendAgentEventsInTransaction(transaction, {
      sessionId: input.sessionId,
      runId: input.agentRunId,
      events: [{
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
      }],
    });
    return question;
  });
}
