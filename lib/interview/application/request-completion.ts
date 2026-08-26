import { and, eq, inArray } from "drizzle-orm";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import { agentRuns, agentSessions, interviewAgentRuns, interviewQuestions, interviews } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { InterviewApplicationError } from "../domain/errors";
import { ensureCompletionJobInTransaction } from "../persistence/completion-repository";
import type { InterviewDatabase } from "../persistence/repository";

export async function requestInterviewCompletion(input: {
  userId: string;
  interviewId: string;
}, dependencies: { database?: InterviewDatabase } = {}) {
  const database = dependencies.database ?? db;
  return database.transaction(async (transaction) => {
    const [interview] = await transaction.select().from(interviews)
      .where(and(eq(interviews.id, input.interviewId), eq(interviews.userId, input.userId)))
      .limit(1)
      .for("update");
    if (!interview) throw new InterviewApplicationError("INTERVIEW_NOT_FOUND", "Interview not found");
    const [session] = await transaction.select({ id: agentSessions.id }).from(agentSessions)
      .where(and(
        eq(agentSessions.id, interview.agentSessionId),
        eq(agentSessions.userId, input.userId),
        eq(agentSessions.capability, "interview"),
      ))
      .limit(1)
      .for("update");
    if (!session) throw new InterviewApplicationError("INTERVIEW_NOT_FOUND", "Interview not found");
    if (interview.status === "completing" || interview.status === "completed") {
      await ensureCompletionJobInTransaction(transaction, interview.id);
      return { status: interview.status, replayed: true as const };
    }
    if (interview.status !== "active") {
      throw new InterviewApplicationError("INTERVIEW_INVALID_STATE", "Interview cannot be ended in its current state");
    }

    const now = new Date();
    const activeRuns = await transaction.select({
      id: interviewAgentRuns.id,
      agentRunId: interviewAgentRuns.currentAgentRunId,
    }).from(interviewAgentRuns).where(and(
      eq(interviewAgentRuns.interviewId, interview.id),
      inArray(interviewAgentRuns.status, ["queued", "running"]),
    ));
    await transaction.update(interviewQuestions).set({ status: "abandoned", closedAt: now })
      .where(and(
        eq(interviewQuestions.interviewId, interview.id),
        eq(interviewQuestions.status, "awaiting_answer"),
      ));
    if (activeRuns.length) {
      await transaction.update(interviewAgentRuns).set({
        status: "cancelled",
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      }).where(and(
        eq(interviewAgentRuns.interviewId, interview.id),
        inArray(interviewAgentRuns.status, ["queued", "running"]),
      ));
      const agentRunIds = activeRuns.flatMap(({ agentRunId }) => agentRunId ? [agentRunId] : []);
      if (agentRunIds.length) {
        await transaction.update(agentRuns).set({ status: "cancelled", completedAt: now })
          .where(inArray(agentRuns.id, agentRunIds));
      }
    }
    await transaction.update(interviews).set({
      status: "completing",
      version: interview.version + 1,
      updatedAt: now,
    }).where(eq(interviews.id, interview.id));
    await ensureCompletionJobInTransaction(transaction, interview.id);
    await transaction.update(agentSessions).set({ status: "idle", updatedAt: now })
      .where(eq(agentSessions.id, interview.agentSessionId));
    await appendAgentEventsInTransaction(transaction, {
      sessionId: interview.agentSessionId,
      events: [{
        type: "interview/completion_requested",
        payload: { interviewId: interview.id },
        dedupeKey: `interview:completion-requested:${interview.id}`,
        visibility: "model_and_user",
      }],
    });
    return { status: "completing" as const, replayed: false as const };
  });
}
