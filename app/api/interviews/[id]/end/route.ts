import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, resumes, resumeVersions } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { createProductionAgentDependencies } from "@/lib/interview/agent/composition";
import { createDrizzleAgentInterviewStore } from "@/lib/interview/agent/drizzle-store";
import { endAgentInterview } from "@/lib/interview/agent/service";
import { isInterviewAgentEnabled } from "@/lib/interview/agent/feature";
import { createProductionCompletionDependencies, scheduleInterviewCompletion } from "@/lib/interview/completion/composition";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isInterviewAgentEnabled()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const [owned] = await db.select({ id: interviews.id }).from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });

    const dependencies = createProductionAgentDependencies({ defer: (task) => after(task) });
    const result = await endAgentInterview({
      interviewId: id,
      store: createDrizzleAgentInterviewStore(db),
      repository: dependencies.repository,
    });
    const completion = createProductionCompletionDependencies((task) => after(task));
    const job = await scheduleInterviewCompletion(completion, id);
    return NextResponse.json({ ...result, status: "scoring", completionJobId: job.id }, { status: 202 });
  } catch (error) {
    console.error("Error ending Agent interview:", sanitizeAIError(error));
    return NextResponse.json({ error: "Failed to end interview" }, { status: 500 });
  }
}
