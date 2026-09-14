import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumes, resumeVersions, resumeJobDescriptions } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const ownedResume = await db.query.resumes.findFirst({
      where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
    });
    if (!ownedResume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const versions = await db
      .select({ storedPath: resumeVersions.storedPath })
      .from(resumeVersions)
      .where(eq(resumeVersions.resumeId, id));

    const jds = await db
      .select({ storedPath: resumeJobDescriptions.storedPath })
      .from(resumeJobDescriptions)
      .where(eq(resumeJobDescriptions.resumeId, id));

    const deletion = [
      ...versions.flatMap(({ storedPath }) => (storedPath ? [storedPath] : [])),
      ...jds.flatMap(({ storedPath }) => (storedPath ? [storedPath] : [])),
    ];

    await db.delete(resumes).where(eq(resumes.id, id));

    if (deletion.length > 0) {
      try {
        const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.replace(/^["']|["']$/g, "").trim();
        await del(deletion, blobToken ? { token: blobToken } : undefined);
      } catch (error) {
        console.error(
          "Resume deleted from database but blob cleanup failed:",
          error
        );
      }
    }

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error deleting resume:", error);
    return NextResponse.json(
      { error: "Failed to delete resume" },
      { status: 500 }
    );
  }
}
