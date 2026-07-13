import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { interviewResumeSnapshots, interviews } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { createProductionAgentDependencies } from "@/lib/interview/agent/composition";
import { isInterviewAgentEnabled } from "@/lib/interview/agent/feature";
import {
  createAgentRunScheduler,
  getRecoveryDisposition,
} from "@/lib/interview/agent/worker";

const paramsSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
});

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  if (!isInterviewAgentEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  const [owned] = await db.select({
    id: interviews.id,
    status: interviews.status,
    configVersion: interviews.configVersion,
  }).from(interviews)
    .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .where(and(eq(interviews.id, parsed.data.id), eq(interviewResumeSnapshots.ownerUserId, userId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  if (owned.configVersion !== 2 || owned.status !== "active") {
    return NextResponse.json({ error: "Run resume requires an active Agent v2 interview" }, { status: 409 });
  }

  const dependencies = createProductionAgentDependencies({ defer: (task) => after(task) });
  const run = await dependencies.repository.getRun(parsed.data.runId);
  if (!run || run.interviewId !== parsed.data.id) {
    return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  }
  const disposition = getRecoveryDisposition(run, new Date());
  if (disposition !== "schedule") {
    return NextResponse.json({ runId: run.id, status: disposition }, { status: 202 });
  }

  const scheduler = createAgentRunScheduler({
    ...dependencies,
    defer: (task) => after(task),
  });
  await scheduler.schedule(run.id);
  return NextResponse.json({ runId: run.id, status: "scheduled" }, { status: 202 });
}
