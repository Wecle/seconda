import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { parsedResumeSchema } from "@/lib/resume/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, versionId } = await params;

    const [resume] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)));

    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const [sourceVersion] = await db
      .select()
      .from(resumeVersions)
      .where(
        and(
          eq(resumeVersions.id, versionId),
          eq(resumeVersions.resumeId, id)
        )
      );

    if (!sourceVersion) {
      return NextResponse.json(
        { error: "Version not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = parsedResumeSchema.safeParse(body.parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parsed resume data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const [latestVersion] = await db
      .select({ versionNumber: resumeVersions.versionNumber })
      .from(resumeVersions)
      .where(eq(resumeVersions.resumeId, id))
      .orderBy(desc(resumeVersions.versionNumber))
      .limit(1);

    const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

    const [newVersion] = await db
      .insert(resumeVersions)
      .values({
        resumeId: id,
        versionNumber: nextVersionNumber,
        originalFilename: sourceVersion.originalFilename,
        storedPath: sourceVersion.storedPath,
        mimeType: sourceVersion.mimeType,
        fileSize: sourceVersion.fileSize,
        extractedText: sourceVersion.extractedText,
        parsedJson: parsed.data,
        parseStatus: "parsed",
      })
      .returning();

    await db
      .update(resumes)
      .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
      .where(eq(resumes.id, id));

    return NextResponse.json(newVersion);
  } catch (error) {
    console.error("Error saving edited resume version:", error);
    return NextResponse.json(
      { error: "Failed to save edited resume version" },
      { status: 500 }
    );
  }
}
