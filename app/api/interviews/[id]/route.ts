import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { getInterviewRoom } from "@/lib/interview/application/get-interview-room";
import { db } from "@/lib/db";
import {
  interviews,
  interviewAnswers,
  interviewQuestions,
  interviewAgentRuns,
  interviewReports,
  interviewCompletionJobs,
  interviewResumeSnapshots,
  agentSessions,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const interviewIdSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  try {
    const view = await getInterviewRoom({ userId, interviewId: parsedId.data });
    if (!view) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }
    return NextResponse.json(view);
  } catch (error) {
    console.error("Failed to project interview room", error);
    return NextResponse.json({ error: "Failed to load interview" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  try {
    const interviewId = parsedId.data;
    const deleted = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: interviews.id,
          agentSessionId: interviews.agentSessionId,
        })
        .from(interviews)
        .where(
          and(
            eq(interviews.id, interviewId),
            eq(interviews.userId, userId),
          ),
        )
        .limit(1);

      if (!existing) return null;

      // 1. Break FK restrictions by clearing triggerAnswerId and setting triggerType to opening
      // (Satisfies check constraint: triggerType = 'opening' AND triggerAnswerId IS NULL)
      await tx
        .update(interviewAgentRuns)
        .set({ triggerType: "opening", triggerAnswerId: null })
        .where(eq(interviewAgentRuns.interviewId, interviewId));

      // 2. Delete answers
      await tx
        .delete(interviewAnswers)
        .where(eq(interviewAnswers.interviewId, interviewId));

      // 3. Delete questions
      await tx
        .delete(interviewQuestions)
        .where(eq(interviewQuestions.interviewId, interviewId));

      // 4. Delete agent runs
      await tx
        .delete(interviewAgentRuns)
        .where(eq(interviewAgentRuns.interviewId, interviewId));

      // 5. Delete completion jobs
      await tx
        .delete(interviewCompletionJobs)
        .where(eq(interviewCompletionJobs.interviewId, interviewId));

      // 6. Delete reports
      await tx
        .delete(interviewReports)
        .where(eq(interviewReports.interviewId, interviewId));

      // 7. Delete resume snapshot
      await tx
        .delete(interviewResumeSnapshots)
        .where(eq(interviewResumeSnapshots.interviewId, interviewId));

      // 8. Delete the interview itself
      await tx
        .delete(interviews)
        .where(eq(interviews.id, interviewId));

      // 9. Delete associated agent session if present
      if (existing.agentSessionId) {
        await tx
          .delete(agentSessions)
          .where(eq(agentSessions.id, existing.agentSessionId));
      }

      return existing;
    });

    if (!deleted) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: interviewId });
  } catch (error) {
    console.error("Failed to delete interview:", error);
    return NextResponse.json({ error: "Failed to delete interview" }, { status: 500 });
  }
}

