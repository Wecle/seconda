import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, interviewQuestions, questionScores } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [interview] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, id));

    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 }
      );
    }

    const questions = await db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, id))
      .orderBy(asc(interviewQuestions.questionIndex));

    const questionsWithScores = await Promise.all(
      questions.map(async (q) => {
        const [score] = await db
          .select()
          .from(questionScores)
          .where(eq(questionScores.questionId, q.id));

        return {
          ...q,
          score: score ?? null,
          feedback: q.feedbackJson ?? null,
        };
      })
    );

    return NextResponse.json({
      interview,
      questions: questionsWithScores,
    });
  } catch (error) {
    console.error("Error fetching interview:", error);
    return NextResponse.json(
      { error: "Failed to fetch interview" },
      { status: 500 }
    );
  }
}
