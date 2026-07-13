import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviewResumeSnapshots, interviews } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { createProductionCompletionDependencies } from "@/lib/interview/completion/composition";
import { getCompletionRecoveryDisposition } from "@/lib/interview/completion/worker";
import { getCompletionResumeBlockReason } from "@/lib/interview/completion/resume-policy";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [owned] = await db.select({
    id: interviews.id,
    status: interviews.status,
    configVersion: interviews.configVersion,
  }).from(interviews)
    .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .where(and(eq(interviews.id, id), eq(interviewResumeSnapshots.ownerUserId, userId))).limit(1);
  if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const dependencies = createProductionCompletionDependencies((task) => after(task));
  const job = await dependencies.repository.getJobByInterview(id);
  const blockReason = getCompletionResumeBlockReason({
    configVersion: owned.configVersion,
    interviewStatus: owned.status,
    hasJob: Boolean(job),
  });
  if (blockReason) return NextResponse.json({ error: blockReason }, { status: 409 });
  if (!job) throw new Error("Completion resume policy allowed a missing job");
  const disposition = getCompletionRecoveryDisposition(job, new Date());
  if (disposition === "schedule") await dependencies.scheduler.schedule(job.id);
  return NextResponse.json({ completionJobId: job.id, status: disposition }, { status: 202 });
}
