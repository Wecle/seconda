import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { interviewResumeSnapshots, interviews } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { isInterviewAgentEnabled } from "@/lib/interview/agent/feature";
import { createDrizzleInterviewAgentRepository } from "@/lib/interview/agent/repository";
import { agentExitMessage } from "@/lib/interview/agent/exit-messages";
import { getRecoveryDisposition } from "@/lib/interview/agent/worker";

const paramsSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  if (!isInterviewAgentEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Agent run" }, { status: 400 });
  }
  const [owned] = await db.select({ id: interviews.id }).from(interviews)
    .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .where(and(eq(interviews.id, parsed.data.id), eq(interviewResumeSnapshots.ownerUserId, userId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });

  const run = await createDrizzleInterviewAgentRepository(db).getRun(parsed.data.runId);
  if (!run || run.interviewId !== parsed.data.id) {
    return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: run.id,
    status: run.status,
    exitReason: run.exitReason,
    userMessage: agentExitMessage(run.exitReason),
    lastEventSequence: run.lastEventSequence,
    recoveryDisposition: getRecoveryDisposition(run, new Date()),
  });
}
