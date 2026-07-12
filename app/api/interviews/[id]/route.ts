import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviewAgentEvents, interviewAgentRuns, interviewCompletionJobs, interviewMessages, interviews, interviewQuestions, questionScores, resumes, resumeVersions } from "@/lib/db/schema";
import { and, eq, asc, desc, inArray } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";
import type { ParsedResume } from "@/lib/resume/types";
import { normalizeDeepDive } from "@/lib/interview/normalize";

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
      .select({ interview: interviews, resumeVersion: resumeVersions })
      .from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)));

    const interview = interviewRow?.interview;
    const resumeVersion = interviewRow?.resumeVersion;

    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 }
      );
    }

    const [rows, agentMessages, publicEvents, latestRuns, completionJobs] = await Promise.all([db
      .select({ question: interviewQuestions, score: questionScores })
      .from(interviewQuestions)
      .leftJoin(questionScores, eq(questionScores.questionId, interviewQuestions.id))
      .where(eq(interviewQuestions.interviewId, id))
      .orderBy(asc(interviewQuestions.questionIndex)),
      interview.configVersion === 2
        ? db.select({ id: interviewMessages.id, runId: interviewMessages.runId, sequence: interviewMessages.sequence, role: interviewMessages.role, kind: interviewMessages.kind, content: interviewMessages.content })
          .from(interviewMessages).where(eq(interviewMessages.interviewId, id)).orderBy(asc(interviewMessages.sequence))
        : Promise.resolve([]),
      interview.configVersion === 2
        ? db.select({ runId: interviewAgentEvents.runId, type: interviewAgentEvents.type, payload: interviewAgentEvents.payload }).from(interviewAgentEvents)
          .innerJoin(interviewAgentRuns, eq(interviewAgentRuns.id, interviewAgentEvents.runId))
          .where(and(eq(interviewAgentRuns.interviewId, id), inArray(interviewAgentEvents.type, ["thinking_started", "thinking_summary", "artifact_committed", "response_started", "run_failed"])))
          .orderBy(asc(interviewAgentEvents.createdAt))
        : Promise.resolve([]),
      interview.configVersion === 2
        ? db.select({ id: interviewAgentRuns.id, status: interviewAgentRuns.status, exitReason: interviewAgentRuns.exitReason, lastEventSequence: interviewAgentRuns.lastEventSequence })
          .from(interviewAgentRuns).where(eq(interviewAgentRuns.interviewId, id)).orderBy(desc(interviewAgentRuns.createdAt)).limit(1)
        : Promise.resolve([]),
      interview.configVersion === 2
        ? db.select({ id: interviewCompletionJobs.id, status: interviewCompletionJobs.status, attemptCount: interviewCompletionJobs.attemptCount })
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
      agentState: interview.configVersion === 2 ? {
        messages: agentMessages,
        latestRun: latestRuns[0] ?? null,
        completionJob: completionJobs[0] ?? null,
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
        publicEvents: publicEvents.filter((event) => event.type !== "artifact_committed"),
      } : null,
      resumeSnapshot: resumeVersion
        ? {
            id: resumeVersion.id,
            versionNumber: resumeVersion.versionNumber,
            originalFilename: resumeVersion.originalFilename,
            originalFileUrl: resumeVersion.storedPath,
            parseStatus: resumeVersion.parseStatus,
            parsedData: (resumeVersion.parsedJson as ParsedResume) ?? null,
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
