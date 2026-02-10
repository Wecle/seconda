import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  interviews,
  interviewQuestions,
  interviewShares,
  questionScores,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
import { verifyInterviewShareToken } from "@/lib/interview/share-token";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = request.nextUrl.searchParams.get("token");

    const [share] = await db
      .select({
        nonce: interviewShares.nonce,
        expiresAt: interviewShares.expiresAt,
        revokedAt: interviewShares.revokedAt,
      })
      .from(interviewShares)
      .where(eq(interviewShares.interviewId, id));

    if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Invalid share token" }, { status: 401 });
    }

    if (!verifyInterviewShareToken({ interviewId: id, nonce: share.nonce, token })) {
      return NextResponse.json({ error: "Invalid share token" }, { status: 401 });
    }

    const [interviewRow] = await db
      .select({
        interview: interviews,
        sharedByName: users.name,
      })
      .from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .leftJoin(users, eq(users.id, resumes.userId))
      .where(eq(interviews.id, id));

    const interview = interviewRow?.interview;
    if (!interview || !interview.reportJson) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const questions = await db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, id))
      .orderBy(asc(interviewQuestions.questionIndex));

    const questionsWithScores = await Promise.all(
      questions.map(async (question) => {
        const [score] = await db
          .select()
          .from(questionScores)
          .where(eq(questionScores.questionId, question.id));

        return {
          id: question.id,
          questionIndex: question.questionIndex,
          questionType: question.questionType,
          topic: question.topic,
          question: question.question,
          answerText: question.answerText,
          score: score
            ? {
                understanding: score.understanding,
                expression: score.expression,
                logic: score.logic,
                depth: score.depth,
                authenticity: score.authenticity,
                reflection: score.reflection,
                overall: score.overall,
              }
            : null,
          feedbackJson: question.feedbackJson ?? null,
        };
      }),
    );

    return NextResponse.json({
      interview: {
        id: interview.id,
        level: interview.level,
        type: interview.type,
        language: interview.language,
        questionCount: interview.questionCount,
        persona: interview.persona,
        status: interview.status,
        overallScore: interview.overallScore,
        reportJson: interview.reportJson,
        startedAt: interview.startedAt,
        completedAt: interview.completedAt,
        sharedByName: interviewRow?.sharedByName ?? null,
      },
      questions: questionsWithScores,
    });
  } catch (error) {
    console.error("Error fetching public interview report:", error);
    return NextResponse.json(
      { error: "Failed to fetch report" },
      { status: 500 },
    );
  }
}
