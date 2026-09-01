import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import type { ParsedResume } from "@/lib/resume/types";
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

    const resumeIds = allResumes.map((r) => r.id);
    if (resumeIds.length === 0) return NextResponse.json([]);

    const allVersions = await db
      .select()
      .from(resumeVersions)
      .where(inArray(resumeVersions.resumeId, resumeIds))
      .orderBy(desc(resumeVersions.versionNumber));

    const versionsByResumeId = new Map<string, typeof allVersions>();
    for (const v of allVersions) {
      const arr = versionsByResumeId.get(v.resumeId) ?? [];
      arr.push(v);
      versionsByResumeId.set(v.resumeId, arr);
    }

    const result = allResumes.map((resume) => {
      const versions = (versionsByResumeId.get(resume.id) ?? []).map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        sourceType: v.sourceType,
        originalFilename: v.originalFilename,
        originalFileUrl: v.storedPath
          ? `/api/resumes/${resume.id}/file?versionId=${v.id}`
          : null,
        parseStatus: v.parseStatus,
        parseError: v.parseError,
        parsedData: (v.parsedJson as ParsedResume) ?? null,
        createdAt: v.createdAt,
      }));

      return {
        ...resume,
        versions,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching resumes:", error);
    return NextResponse.json(
      { error: "Failed to fetch resumes" },
      { status: 500 }
    );
  }
}
