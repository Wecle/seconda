import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviewQuestions, interviews, resumes, resumeVersions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const questionId = request.nextUrl.searchParams.get("questionId");
    if (!questionId) {
      return NextResponse.json({ error: "questionId is required" }, { status: 400 });
    }

    const [interviewRow] = await db
      .select({ id: interviews.id })
      .from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)));

    if (!interviewRow) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const [question] = await db
      .select({
        id: interviewQuestions.id,
        topic: interviewQuestions.topic,
        tip: interviewQuestions.tip,
      })
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.id, questionId),
          eq(interviewQuestions.interviewId, id),
        ),
      );

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    return NextResponse.json({
      questionId: question.id,
      topic: question.topic,
      tip: question.tip,
    });
  } catch (error) {
    console.error("Error fetching current question meta:", error);
    return NextResponse.json(
      { error: "Failed to fetch current question meta" },
      { status: 500 },
    );
  }
}
