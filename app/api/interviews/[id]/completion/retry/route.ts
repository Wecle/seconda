import { z } from "zod";
import { after } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { executeInterviewCompletion } from "@/lib/interview/application/execute-completion";
import { retryCompletionJob } from "@/lib/interview/persistence/completion-repository";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();

export async function handleRetryCompletion(input: {
  userId: string;
  interviewId: string;
}, dependencies: { database?: typeof db } = {}) {
  const result = await retryCompletionJob({
    database: dependencies.database ?? db,
    userId: input.userId,
    interviewId: input.interviewId,
  });

  if (result.state === "not_found") {
    return { status: 404, body: { error: "Interview not found" } };
  }

  if (result.state === "invalid_state") {
    return {
      status: 409,
      body: { error: "Interview cannot be retried in its current state", status: result.status },
    };
  }

  if (result.state === "unavailable") {
    return {
      status: 409,
      body: { error: "Completion job is currently active and cannot be retried", status: result.status },
    };
  }

  if (result.state === "completed") {
    return { status: 200, body: { status: "completed", job: result.job ?? null } };
  }

  return { status: 202, body: { status: "pending", job: result.job } };
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
    const outcome = await handleRetryCompletion({ userId, interviewId: parsedId.data });

    if (outcome.status === 202) {
      after(async () => {
        await executeInterviewCompletion({
          interviewId: parsedId.data,
          userId,
        }).catch((error) => {
          console.error("Failed to retry interview completion", error instanceof Error ? error.name : "Unknown error");
        });
      });
    }

    return Response.json(outcome.body, { status: outcome.status });
  } catch (error) {
    console.error("Failed to retry completion job", error);
    return Response.json({ error: "Failed to retry completion" }, { status: 500 });
  }
}
