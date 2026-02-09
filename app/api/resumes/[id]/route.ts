import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [resume] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(eq(resumes.id, id));

    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const versions = await db
      .select({ storedPath: resumeVersions.storedPath })
      .from(resumeVersions)
      .where(eq(resumeVersions.resumeId, id));

    await db.delete(resumes).where(eq(resumes.id, id));

    const blobUrls = versions
      .map((version) => version.storedPath)
      .filter((url): url is string => Boolean(url));

    if (blobUrls.length > 0) {
      try {
        await del(blobUrls);
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
