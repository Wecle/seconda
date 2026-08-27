import { z } from "zod";
import { after } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { executeInterviewTurn } from "@/lib/interview/application/execute-turn";
import { submitAnswerRateLimiter } from "@/lib/interview/application/rate-limit";
import { submitInterviewAnswer } from "@/lib/interview/application/submit-answer";
import { InterviewApplicationError } from "@/lib/interview/domain/errors";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();

function applicationErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  if (error instanceof z.ZodError) return Response.json({ error: "Invalid answer" }, { status: 400 });
  if (error instanceof InterviewApplicationError) {
    if (error.code === "INTERVIEW_NOT_FOUND") return Response.json({ error: "Interview not found" }, { status: 404 });
    return Response.json({ error: error.code }, { status: 409 });
  }
  console.error("Failed to submit interview answer", error);
  return Response.json({ error: "Failed to submit answer" }, { status: 500 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) return Response.json({ error: "Interview not found" }, { status: 404 });

  const limitResult = submitAnswerRateLimiter.check(`${userId}:${parsedId.data}`);
  if (!limitResult.allowed) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(limitResult.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
  let submitted: Awaited<ReturnType<typeof submitInterviewAnswer>>;
  try {
    submitted = await submitInterviewAnswer({
      userId,
      interviewId: parsedId.data,
      idempotencyKey,
      request: await request.json(),
    });
  } catch (error) {
    return applicationErrorResponse(error);
  }

  after(async () => {
    await executeInterviewTurn({
      userId,
      interviewRunId: submitted.run.id,
    }).catch((error) => {
      console.error("Failed to execute interview turn", error instanceof Error ? error.name : "Unknown error");
    });
  });
  return Response.json({ runId: submitted.run.id, replayed: submitted.replayed }, { status: 202 });
}
