import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { getInterviewRoom } from "@/lib/interview/application/get-interview-room";

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
    const view = await getInterviewRoom({ userId, interviewId: parsedId.data });
    if (!view) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }
    return NextResponse.json(view);
  } catch (error) {
    console.error("Failed to project interview room", error);
    return NextResponse.json({ error: "Failed to load interview" }, { status: 500 });
  }
}
