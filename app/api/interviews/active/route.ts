import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  interviews,
  interviewResumeSnapshots,
  resumeVersions,
} from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { ActiveInterviewSummary } from "@/components/dashboard/types";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [row] = await db
      .select({
        id: interviews.id,
        resumeVersionId: interviews.resumeVersionId,
        status: interviews.status,
        targetRole: interviews.targetRole,
        targetLevel: interviews.targetLevel,
        startedAt: interviews.startedAt,
        updatedAt: interviews.updatedAt,
        snapshotResumeId: interviewResumeSnapshots.resumeId,
        snapshotResumeTitle: interviewResumeSnapshots.resumeTitle,
        versionResumeId: resumeVersions.resumeId,
      })
      .from(interviews)
      .leftJoin(
        interviewResumeSnapshots,
        eq(interviews.id, interviewResumeSnapshots.interviewId),
      )
      .leftJoin(
        resumeVersions,
        eq(interviews.resumeVersionId, resumeVersions.id),
      )
      .where(
        and(
          eq(interviews.userId, userId),
          inArray(interviews.status, ["initializing", "active", "completing"]),
        ),
      )
      .orderBy(desc(interviews.updatedAt))
      .limit(1);

    if (!row) {
      return NextResponse.json(null);
    }

    const result: ActiveInterviewSummary = {
      id: row.id,
      resumeId: row.snapshotResumeId ?? row.versionResumeId ?? null,
      resumeVersionId: row.resumeVersionId,
      resumeTitle: row.snapshotResumeTitle ?? null,
      targetRole: row.targetRole,
      targetLevel: row.targetLevel,
      status: row.status as ActiveInterviewSummary["status"],
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching active interview:", error);
    return NextResponse.json(
      { error: "Failed to fetch active interview" },
      { status: 500 },
    );
  }
}
