import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/session";
import { parsedResumeSchema } from "@/lib/resume/types";
import {
  editResumeVersion,
  ResumeEditError,
} from "@/lib/resume/edit-resume-version";

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

    const body = await request.json();
    const parsed = parsedResumeSchema.safeParse(body.parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parsed resume data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const newVersion = await editResumeVersion(db, {
      ownerUserId: userId,
      resumeId: id,
      sourceVersionId: versionId,
      parsed: parsed.data,
    });

    return NextResponse.json(newVersion);
  } catch (error) {
    if (error instanceof ResumeEditError) {
      if (error.code === "resume_not_found") {
        return NextResponse.json({ error: "Resume not found" }, { status: 404 });
      }
      if (error.code === "version_not_found") {
        return NextResponse.json({ error: "Version not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Uploaded resume attachment is unavailable" },
        { status: 409 },
      );
    }
    console.error("Error saving edited resume version:", error);
    return NextResponse.json(
      { error: "Failed to save edited resume version" },
      { status: 500 }
    );
  }
}
