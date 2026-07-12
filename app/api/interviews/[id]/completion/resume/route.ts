import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, resumes, resumeVersions } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { createProductionCompletionDependencies, scheduleInterviewCompletion } from "@/lib/interview/completion/composition";
import { getCompletionRecoveryDisposition } from "@/lib/interview/completion/worker";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [owned] = await db.select({ id: interviews.id }).from(interviews)
    .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
    .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
    .where(and(eq(interviews.id, id), eq(resumes.userId, userId))).limit(1);
  if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const dependencies = createProductionCompletionDependencies((task) => after(task));
  let job = await dependencies.repository.getJobByInterview(id);
  if (!job) job = await scheduleInterviewCompletion(dependencies, id);
  const disposition = getCompletionRecoveryDisposition(job, new Date());
  if (disposition === "schedule") await dependencies.scheduler.schedule(job.id);
  return NextResponse.json({ completionJobId: job.id, status: disposition }, { status: 202 });
}
