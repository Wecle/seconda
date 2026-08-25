import { after } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { executeInterviewOpening } from "@/lib/interview/application/execute-opening";
import { executeInterviewTurn } from "@/lib/interview/application/execute-turn";
import { retryInterviewRun } from "@/lib/interview/persistence/repository";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const values = await params;
  const interviewId = idSchema.safeParse(values.id);
  const runId = idSchema.safeParse(values.runId);
  if (!interviewId.success || !runId.success) {
    return Response.json({ error: "Interview run not found" }, { status: 404 });
  }
  const retried = await retryInterviewRun({
    database: db,
    userId,
    interviewId: interviewId.data,
    interviewRunId: runId.data,
  });
  if (retried.state === "not_found") {
    return Response.json({ error: "Interview run not found" }, { status: 404 });
  }
  if (retried.state === "conflict") {
    return Response.json({ error: "Interview run cannot be retried", status: retried.status }, { status: 409 });
  }
  after(async () => {
    const execution = retried.run.triggerType === "opening"
      ? executeInterviewOpening({ userId, openingRunId: retried.run.id })
      : executeInterviewTurn({ userId, interviewRunId: retried.run.id });
    await execution.catch((error) => {
      console.error("Failed to retry interview run", error instanceof Error ? error.name : "Unknown error");
    });
  });
  return Response.json({ runId: retried.run.id }, { status: 202 });
}
