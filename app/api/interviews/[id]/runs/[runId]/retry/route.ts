import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { interviewResumeSnapshots, interviews } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { createProductionAgentDependencies } from "@/lib/interview/agent/application/composition";
import { retryFailedAgentRun } from "@/lib/interview/agent/application/interview-service";
import { createAgentRunScheduler } from "@/lib/interview/agent/application/run-worker";

const paramsSchema = z.object({ id: z.string().uuid(), runId: z.string().uuid() });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  const [owned] = await db.select({ id: interviews.id, status: interviews.status })
    .from(interviews)
    .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .where(and(
      eq(interviews.id, parsed.data.id),
      eq(interviewResumeSnapshots.ownerUserId, userId),
    ))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  if (owned.status !== "active") {
    return NextResponse.json({ error: "Run retry requires an active interview" }, { status: 409 });
  }

  const dependencies = createProductionAgentDependencies({ defer: (task) => after(task) });
  const scheduler = createAgentRunScheduler({
    ...dependencies,
    defer: (task) => after(task),
  });
  try {
    const result = await retryFailedAgentRun({
      interviewId: parsed.data.id,
      failedRunId: parsed.data.runId,
      repository: dependencies.repository,
      scheduler,
      now: new Date(),
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "RETRY_RUN_FAILED";
    const knownConflictCodes = new Set([
      "RETRY_RUN_NOT_FAILED",
      "RETRY_RUN_NOT_REPLACEABLE",
      "RETRY_RUN_TRIGGER_MISSING",
      "RETRY_RUN_ANSWER_MISSING",
      "RETRY_RUN_STALE",
    ]);
    const status = errorCode === "RETRY_RUN_NOT_FOUND"
      ? 404
      : knownConflictCodes.has(errorCode) ? 409 : 500;
    return NextResponse.json({ error: errorCode }, { status });
  }
}
