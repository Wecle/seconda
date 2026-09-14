import { z } from "zod";
import { after } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { executeInterviewCompletion } from "@/lib/interview/application/execute-completion";
import { getInterviewRoom } from "@/lib/interview/application/get-interview-room";
import { requestInterviewCompletion } from "@/lib/interview/application/request-completion";
import { InterviewApplicationError } from "@/lib/interview/domain/errors";
import type { InterviewDatabase } from "@/lib/interview/persistence/repository";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();

export async function handleEndInterview(
  input: { userId: string; interviewId: string },
  dependencies: {
    requestCompletion?: typeof requestInterviewCompletion;
    getRoom?: typeof getInterviewRoom;
    scheduleCompletion?: (task: () => Promise<void>) => void;
    executeCompletion?: typeof executeInterviewCompletion;
    database?: InterviewDatabase;
  } = {},
) {
  const requestCompletion = dependencies.requestCompletion ?? requestInterviewCompletion;
  const getRoom = dependencies.getRoom ?? getInterviewRoom;
  const schedule = dependencies.scheduleCompletion ?? after;
  const executeCompletion = dependencies.executeCompletion ?? executeInterviewCompletion;

  const outcome = await requestCompletion(
    { userId: input.userId, interviewId: input.interviewId },
    { database: dependencies.database },
  );
  schedule(async () => {
    await executeCompletion(
      {
        interviewId: input.interviewId,
        userId: input.userId,
      },
      { database: dependencies.database },
    ).catch((error) => {
      console.error("Failed to execute interview completion", error instanceof Error ? error.stack ?? error.message : error);
    });
  });

  const view = await getRoom(
    { userId: input.userId, interviewId: input.interviewId },
    { database: dependencies.database },
  );
  return { outcome, view };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) return Response.json({ error: "Interview not found" }, { status: 404 });
  try {
    const { view } = await handleEndInterview({ userId, interviewId: parsedId.data });
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
