import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, resumes, resumeVersions } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { candidateMessageRequestSchema } from "@/lib/interview/agent/api-contracts";
import { createProductionAgentDependencies } from "@/lib/interview/agent/composition";
import { createDrizzleAgentInterviewStore } from "@/lib/interview/agent/drizzle-store";
import { submitCandidateMessage } from "@/lib/interview/agent/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (process.env.INTERVIEW_AGENT_V2_ENABLED !== "true") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const parsed = candidateMessageRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    if (!(await ownsInterview(id, userId))) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }
    const dependencies = createProductionAgentDependencies();
    const result = await submitCandidateMessage({
      input: { interviewId: id, ...parsed.data },
      store: createDrizzleAgentInterviewStore(db),
      repository: dependencies.repository,
      executor: dependencies.executor,
      signal: request.signal,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    console.error("Error submitting Agent interview message:", sanitizeAIError(error));
    return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
  }
}

async function ownsInterview(interviewId: string, userId: string) {
  const [row] = await db.select({ id: interviews.id }).from(interviews)
    .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
    .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
    .where(and(eq(interviews.id, interviewId), eq(resumes.userId, userId)))
    .limit(1);
  return Boolean(row);
}
