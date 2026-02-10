import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes, resumeVersions, interviews } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import type { ParsedResume } from "@/lib/resume/types";
import { normalizeInterviewConfig } from "@/lib/interview/settings";
import { getCurrentUserId } from "@/lib/auth/session";

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allResumes = await db
      .select()
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .orderBy(desc(resumes.createdAt));

    const result = await Promise.all(
      allResumes.map(async (resume) => {
        const versions = await db
          .select()
          .from(resumeVersions)
          .where(eq(resumeVersions.resumeId, resume.id))
          .orderBy(desc(resumeVersions.versionNumber));

        const versionsWithInterviews = await Promise.all(
          versions.map(async (v) => {
            const versionInterviews = await db
              .select()
              .from(interviews)
              .where(eq(interviews.resumeVersionId, v.id))
              .orderBy(desc(interviews.createdAt));

            return {
              id: v.id,
              versionNumber: v.versionNumber,
              originalFilename: v.originalFilename,
              originalFileUrl: v.storedPath,
              parseStatus: v.parseStatus,
              parseError: v.parseError,
              parsedData: (v.parsedJson as ParsedResume) ?? null,
              createdAt: v.createdAt,
              interviews: versionInterviews.map((i) => ({
                id: i.id,
                status: i.status,
                type: i.type,
                level: i.level,
                overallScore: i.overallScore,
                questionCount: i.questionCount,
                createdAt: i.createdAt,
                completedAt: i.completedAt,
              })),
            };
          })
        );

        return {
          ...resume,
          interviewSettings: normalizeInterviewConfig(resume.interviewSettings),
          versions: versionsWithInterviews,
        };
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching resumes:", error);
    return NextResponse.json(
      { error: "Failed to fetch resumes" },
      { status: 500 }
    );
  }
}
