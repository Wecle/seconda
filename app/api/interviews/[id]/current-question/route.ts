import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, interviewQuestions, resumes, resumeVersions } from "@/lib/db/schema";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const [interviewRow] = await db
      .select({ interview: interviews })
      .from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)));

    const interview = interviewRow?.interview;
    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const [question] = await db
      .select({
        id: interviewQuestions.id,
        questionIndex: interviewQuestions.questionIndex,
        question: interviewQuestions.question,
      })
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.interviewId, id),
          isNull(interviewQuestions.answeredAt),
        ),
      )
      .orderBy(asc(interviewQuestions.questionIndex))
      .limit(1);

    const answeredQuestions = await db
      .select({ id: interviewQuestions.id })
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.interviewId, id),
          isNotNull(interviewQuestions.answeredAt),
        ),
      );

    return NextResponse.json({
      progress: {
        current: answeredQuestions.length,
        total: interview.questionCount,
      },
      question: question ?? null,
    });
  } catch (error) {
    console.error("Error fetching current question:", error);
    return NextResponse.json(
      { error: "Failed to fetch current question" },
      { status: 500 },
    );
  }
}
