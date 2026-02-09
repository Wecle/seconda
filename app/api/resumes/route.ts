import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
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

        return {
          ...resume,
          interviewSettings: normalizeInterviewConfig(resume.interviewSettings),
          versions: versions.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            originalFilename: v.originalFilename,
            originalFileUrl: v.storedPath,
            parseStatus: v.parseStatus,
            parseError: v.parseError,
            parsedData: (v.parsedJson as ParsedResume) ?? null,
            createdAt: v.createdAt,
          })),
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
