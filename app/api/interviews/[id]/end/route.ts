import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { getInterviewRoom } from "@/lib/interview/application/get-interview-room";
import { requestInterviewCompletion } from "@/lib/interview/application/request-completion";
import { InterviewApplicationError } from "@/lib/interview/domain/errors";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) return Response.json({ error: "Interview not found" }, { status: 404 });
  try {
    await requestInterviewCompletion({ userId, interviewId: parsedId.data });
    const view = await getInterviewRoom({ userId, interviewId: parsedId.data });
    if (!view) return Response.json({ error: "Interview not found" }, { status: 404 });
    return Response.json(view);
  } catch (error) {
    if (error instanceof InterviewApplicationError) {
      return Response.json(
        { error: error.code },
        { status: error.code === "INTERVIEW_NOT_FOUND" ? 404 : 409 },
      );
    }
    console.error("Failed to end interview", error);
    return Response.json({ error: "Failed to end interview" }, { status: 500 });
  }
}
