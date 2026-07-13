import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviewAgentEvents, interviewAgentRuns, interviewCompletionJobs, interviewMessages, interviewQuestions, interviewResumeSnapshots, interviews, questionScores } from "@/lib/db/schema";
import { and, eq, asc, desc } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";
import type { ParsedResume } from "@/lib/resume/types";
import { normalizeDeepDive } from "@/lib/interview/normalize";
import type { AgentExitReason } from "@/lib/interview/agent/contracts";
import { agentExitMessage } from "@/lib/interview/agent/exit-messages";
import { getRecoveryDisposition } from "@/lib/interview/agent/worker";
import { getCompletionRecoveryDisposition } from "@/lib/interview/completion/worker";
import { serializePublicRoomEvents } from "@/lib/interview/agent/room-snapshot";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const [interviewRow] = await db
      .select({ interview: interviews, resumeSnapshot: interviewResumeSnapshots })
      .from(interviews)
      .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
      .where(and(eq(interviews.id, id), eq(interviewResumeSnapshots.ownerUserId, userId)));

    const interview = interviewRow?.interview;
    const resumeSnapshot = interviewRow?.resumeSnapshot;

    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 }
      );
    }

    const usesAgentRoom = interview.status === "active" || interview.configVersion === 2;

    const [rows, agentMessages, publicEvents, latestRuns, completionJobs] = await Promise.all([db
      .select({ question: interviewQuestions, score: questionScores })
      .from(interviewQuestions)
      .leftJoin(questionScores, eq(questionScores.questionId, interviewQuestions.id))
      .where(eq(interviewQuestions.interviewId, id))
      .orderBy(asc(interviewQuestions.questionIndex)),
      usesAgentRoom
        ? db.select({ id: interviewMessages.id, runId: interviewMessages.runId, sequence: interviewMessages.sequence, role: interviewMessages.role, kind: interviewMessages.kind, content: interviewMessages.content })
          .from(interviewMessages).where(eq(interviewMessages.interviewId, id)).orderBy(asc(interviewMessages.sequence))
        : Promise.resolve([]),
      usesAgentRoom
        ? db.select({ id: interviewAgentEvents.id, runId: interviewAgentEvents.runId, sequence: interviewAgentEvents.sequence, attemptId: interviewAgentEvents.attemptId, logicalMessageId: interviewAgentEvents.logicalMessageId, visibility: interviewAgentEvents.visibility, type: interviewAgentEvents.type, payload: interviewAgentEvents.payload, createdAt: interviewAgentEvents.createdAt }).from(interviewAgentEvents)
          .innerJoin(interviewAgentRuns, eq(interviewAgentRuns.id, interviewAgentEvents.runId))
          .where(and(
            eq(interviewAgentRuns.interviewId, id),
            eq(interviewAgentEvents.visibility, "public"),
          ))
          .orderBy(asc(interviewAgentRuns.createdAt), asc(interviewAgentRuns.id), asc(interviewAgentEvents.sequence))
        : Promise.resolve([]),
      usesAgentRoom
        ? db.select({ id: interviewAgentRuns.id, interviewId: interviewAgentRuns.interviewId, status: interviewAgentRuns.status, phase: interviewAgentRuns.phase, attemptId: interviewAgentRuns.attemptId, attemptNumber: interviewAgentRuns.attemptNumber, provisionalMessageId: interviewAgentRuns.provisionalMessageId, exitReason: interviewAgentRuns.exitReason, leaseOwner: interviewAgentRuns.leaseOwner, leaseExpiresAt: interviewAgentRuns.leaseExpiresAt, leaseGeneration: interviewAgentRuns.leaseGeneration, resumeCount: interviewAgentRuns.resumeCount, nextResumeAt: interviewAgentRuns.nextResumeAt, checkpoint: interviewAgentRuns.checkpointJson, trigger: interviewAgentRuns.triggerJson, lastEventSequence: interviewAgentRuns.lastEventSequence })
          .from(interviewAgentRuns).where(eq(interviewAgentRuns.interviewId, id)).orderBy(desc(interviewAgentRuns.createdAt)).limit(1)
        : Promise.resolve([]),
      usesAgentRoom
        ? db.select({ id: interviewCompletionJobs.id, interviewId: interviewCompletionJobs.interviewId, status: interviewCompletionJobs.status, leaseOwner: interviewCompletionJobs.leaseOwner, leaseExpiresAt: interviewCompletionJobs.leaseExpiresAt, leaseGeneration: interviewCompletionJobs.leaseGeneration, attemptCount: interviewCompletionJobs.attemptCount, nextAttemptAt: interviewCompletionJobs.nextAttemptAt })
          .from(interviewCompletionJobs).where(eq(interviewCompletionJobs.interviewId, id)).limit(1)
        : Promise.resolve([]),
    ]);

    const questionsWithScores = rows.map(({ question, score }) => {
      const feedback = question.feedbackJson as Record<string, unknown> | null;
      return {
        ...question,
        score: score ?? null,
        feedback: feedback
          ? {
              ...feedback,
              deepDive: normalizeDeepDive(feedback?.deepDive),
            }
          : null,
      };
    });

    return NextResponse.json({
      interview,
      questions: questionsWithScores,
      agentState: usesAgentRoom ? {
        messages: agentMessages,
        latestRun: latestRuns[0]
          ? {
              id: latestRuns[0].id,
              status: latestRuns[0].status,
              exitReason: latestRuns[0].exitReason,
              lastEventSequence: latestRuns[0].lastEventSequence,
              userMessage: agentExitMessage(latestRuns[0].exitReason as AgentExitReason | null),
              recoveryDisposition: getRecoveryDisposition({
                ...latestRuns[0],
                status: latestRuns[0].status as "running" | "completed" | "failed",
                phase: latestRuns[0].phase as import("@/lib/interview/agent/repository").AgentRunPhase,
                exitReason: latestRuns[0].exitReason as AgentExitReason | null,
                checkpoint: latestRuns[0].checkpoint as import("@/lib/interview/agent/contracts").AgentCheckpoint | null,
                trigger: latestRuns[0].trigger as import("@/lib/interview/agent/repository").AgentRunTrigger | null,
              }, new Date()),
            }
          : null,
        completionJob: completionJobs[0]
          ? {
              id: completionJobs[0].id,
              status: completionJobs[0].status as import("@/lib/interview/completion/repository").CompletionJobStatus,
              attemptCount: completionJobs[0].attemptCount,
              recoveryDisposition: getCompletionRecoveryDisposition({
                ...completionJobs[0],
                status: completionJobs[0].status as import("@/lib/interview/completion/repository").CompletionJobStatus,
              }, new Date()),
            }
          : null,
        scoringProgress: rows.reduce((progress, { question }) => {
          if (!question.answeredAt) return progress;
          progress.total += 1;
          const key = question.scoreStatus as "pending" | "scoring" | "scored" | "failed";
          if (key in progress) progress[key] += 1;
          return progress;
        }, { total: 0, pending: 0, scoring: 0, scored: 0, failed: 0 }),
        artifacts: publicEvents.filter((event) => event.type === "artifact_committed").map((event) => {
          const payload = event.payload as { type?: string };
          return {
            ...(payload as object),
            runId: event.runId,
            ...(payload.type === "background_saved" ? { artifactId: `coverage:${event.runId}` } : {}),
          };
        }),
        publicEvents: serializePublicRoomEvents(publicEvents),
      } : null,
      resumeSnapshot: resumeSnapshot
        ? {
            id: resumeSnapshot.id,
            title: resumeSnapshot.resumeTitle,
            versionNumber: resumeSnapshot.versionNumber,
            originalFilename: resumeSnapshot.originalFilename,
            originalFileUrl: resumeSnapshot.storedPath,
            parseStatus: resumeSnapshot.parseStatus,
            parsedData: (resumeSnapshot.parsedJson as ParsedResume) ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching interview:", error);
    return NextResponse.json(
      { error: "Failed to fetch interview" },
      { status: 500 }
    );
  }
}
