import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { loadOwnedInterviewResumeSnapshot } from "@/lib/interview/persistence/repository";
import { db } from "@/lib/db";

const interviewIdSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  try {
    const data = await loadOwnedInterviewResumeSnapshot({
      database: db,
      userId,
      interviewId: parsedId.data,
    });

    if (!data) {
      return NextResponse.json({ error: "Resume snapshot not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load interview resume snapshot", error);
    return NextResponse.json({ error: "Failed to load resume snapshot" }, { status: 500 });
  }
}
