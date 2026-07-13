import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/session";
import { deleteResumePreservingSnapshots } from "@/lib/interview/resume-snapshot";

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

    const deletion = await deleteResumePreservingSnapshots(db, {
      resumeId: id,
      ownerUserId: userId,
    });

    if (!deletion) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    if (deletion.length > 0) {
      try {
        await del(deletion);
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
