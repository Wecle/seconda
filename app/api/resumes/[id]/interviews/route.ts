import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  interviews,
  interviewResumeSnapshots,
  interviewReports,
  interviewCompletionJobs,
  resumeVersions,
  resumes,
} from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { InterviewSummaryItem } from "@/components/dashboard/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: resumeId } = await params;
  if (!resumeId) {
    return NextResponse.json({ error: "Missing resume id" }, { status: 400 });
  }

  try {
    // 1. Verify resume ownership
    const [resume] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .limit(1);

    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    // 2. Fetch all versions of this resume to map version numbers
    const versions = await db
      .select({
        id: resumeVersions.id,
        versionNumber: resumeVersions.versionNumber,
      })
      .from(resumeVersions)
      .where(eq(resumeVersions.resumeId, resumeId));

    const versionMap = new Map<string, number>();
    for (const v of versions) {
      versionMap.set(v.id, v.versionNumber);
    }

    const versionIds = versions.map((v) => v.id);
    if (versionIds.length === 0) {
      return NextResponse.json([]);
    }

    // 3. Query all interviews associated with this resume's versions
    const interviewRecords = await db
      .select({
        id: interviews.id,
        userId: interviews.userId,
        resumeVersionId: interviews.resumeVersionId,
        status: interviews.status,
        language: interviews.language,
        persona: interviews.persona,
        interviewType: interviews.interviewType,
        targetLevel: interviews.targetLevel,
        targetRole: interviews.targetRole,
        preference: interviews.preference,
        preferenceTags: interviews.preferenceTags,
        targetRoundCount: interviews.targetRoundCount,
        answeredRoundCount: interviews.answeredRoundCount,
        startedAt: interviews.startedAt,
        completedAt: interviews.completedAt,
        createdAt: interviews.createdAt,
        updatedAt: interviews.updatedAt,
        snapshotVersionNumber: interviewResumeSnapshots.versionNumber,
        reportOverallScore: interviewReports.overallScore,
        reportScoreStatus: interviewReports.scoreStatus,
        completionJobStatus: interviewCompletionJobs.status,
      })
      .from(interviews)
      .leftJoin(
        interviewResumeSnapshots,
        eq(interviews.id, interviewResumeSnapshots.interviewId),
      )
      .leftJoin(
        interviewReports,
        eq(interviews.id, interviewReports.interviewId),
      )
      .leftJoin(
        interviewCompletionJobs,
        eq(interviews.id, interviewCompletionJobs.interviewId),
      )
      .where(
        and(
          eq(interviews.userId, userId),
          inArray(interviews.resumeVersionId, versionIds),
        ),
      )
      .orderBy(desc(interviews.createdAt));

    const now = Date.now();
    const result: InterviewSummaryItem[] = interviewRecords.map((row) => {
      const versionNumber =
        row.snapshotVersionNumber ??
        versionMap.get(row.resumeVersionId) ??
        1;

      const startTime = row.startedAt
        ? new Date(row.startedAt).getTime()
        : new Date(row.createdAt).getTime();

      let durationSeconds = 0;
      if (row.completedAt) {
        const endTime = new Date(row.completedAt).getTime();
        durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
      } else if (row.status === "active" || row.status === "completing" || row.status === "initializing") {
        const endTime = row.updatedAt ? new Date(row.updatedAt).getTime() : now;
        durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
      }

      let effectiveStatus: InterviewSummaryItem["status"] =
        row.status as InterviewSummaryItem["status"];

      if (row.completionJobStatus === "failed") {
        effectiveStatus = "failed";
      }

      return {
        id: row.id,
        resumeId,
        resumeVersionId: row.resumeVersionId,
        versionNumber,
        status: effectiveStatus,
        language: row.language,
        persona: row.persona,
        interviewType: row.interviewType,
        targetLevel: row.targetLevel,
        targetRole: row.targetRole,
        preference: row.preference,
        preferenceTags: row.preferenceTags ?? [],
        targetRoundCount: row.targetRoundCount,
        answeredRoundCount: row.answeredRoundCount,
        overallScore: row.reportOverallScore,
        scoreStatus: row.reportScoreStatus,
        completionJobStatus: row.completionJobStatus,
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        durationSeconds,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching resume interviews:", error);
    return NextResponse.json(
      { error: "Failed to fetch interviews" },
      { status: 500 },
    );
  }
}
