import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { getBlob } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const requestedVersionId = searchParams.get("versionId");

    const resume = await db.query.resumes.findFirst({
      where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
    });

    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const targetVersionId = requestedVersionId || resume.currentVersionId;
    if (!targetVersionId) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const version = await db.query.resumeVersions.findFirst({
      where: and(
        eq(resumeVersions.id, targetVersionId),
        eq(resumeVersions.resumeId, id)
      ),
    });

    if (!version || !version.storedPath) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const file = await getBlob(version.storedPath);

    return new NextResponse(Buffer.from(file.body), {
      status: 200,
      headers: {
        "Content-Type": file.contentType || version.mimeType || "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(version.originalFilename || "resume.pdf")}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error serving resume file:", error);
    return NextResponse.json(
      { error: "Failed to load resume file" },
      { status: 500 }
    );
  }
}
