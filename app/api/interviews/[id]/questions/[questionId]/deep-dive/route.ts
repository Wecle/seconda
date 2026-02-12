import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  interviews,
  interviewQuestions,
  resumes,
  resumeVersions,
  deepDiveSessions,
  deepDiveMessages,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";

type RouteParams = { params: Promise<{ id: string; questionId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, questionId } = await params;

    const [interviewRow] = await db
      .select({ interview: interviews })
      .from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)));

    if (!interviewRow) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const [question] = await db
      .select()
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.id, questionId),
          eq(interviewQuestions.interviewId, id)
        )
      );

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const mode = request.nextUrl.searchParams.get("mode");
    if (!mode || !["followup", "coach"].includes(mode)) {
      return NextResponse.json(
        { error: "Invalid or missing mode parameter" },
        { status: 400 }
      );
    }

    const [session] = await db
      .select()
      .from(deepDiveSessions)
      .where(
        and(
          eq(deepDiveSessions.questionId, questionId),
          eq(deepDiveSessions.mode, mode)
        )
      );

    if (!session) {
      return NextResponse.json({ session: null, messages: [] });
    }

    const messages = await db
      .select()
      .from(deepDiveMessages)
      .where(eq(deepDiveMessages.sessionId, session.id))
      .orderBy(asc(deepDiveMessages.createdAt));

    return NextResponse.json({ session, messages });
  } catch (error) {
    console.error("Error fetching deep dive session:", error);
    return NextResponse.json(
      { error: "Failed to fetch deep dive session" },
      { status: 500 }
    );
  }
}
