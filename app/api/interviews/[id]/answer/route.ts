import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  interviews,
  interviewQuestions,
  questionScores,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import { eq, and, asc, isNull, isNotNull } from "drizzle-orm";
import {
  generateInterviewQuestions,
  scoreInterviewAnswer,
} from "@/lib/interview";
import type { ParsedResume } from "@/lib/resume/types";
import { getCurrentUserId } from "@/lib/auth/session";

const answerSchema = z.object({
  questionId: z.string().uuid(),
  answerText: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const rawBody = await request.json();
    const parsed = answerSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;

    const [interviewRow] = await db
      .select({ interview: interviews })
      .from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)));

    const interview = interviewRow?.interview;

    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 }
      );
    }

    if (interview.status !== "active") {
      return NextResponse.json(
        { error: "Interview is not active" },
        { status: 400 }
      );
    }

    const [question] = await db
      .select()
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.id, body.questionId),
          eq(interviewQuestions.interviewId, id),
          isNull(interviewQuestions.answeredAt)
        )
      );

    if (!question) {
      return NextResponse.json(
        { error: "Question not found or already answered" },
        { status: 400 }
      );
    }

    await db
      .update(interviewQuestions)
      .set({ answerText: body.answerText, answeredAt: new Date() })
      .where(eq(interviewQuestions.id, body.questionId));

    const [resumeVersion] = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.id, interview.resumeVersionId));

    const resume = resumeVersion?.parsedJson as ParsedResume | null;
    const resumeContext = resume
      ? `${resume.name} - ${resume.title}. Skills: ${resume.skills.join(", ")}`
      : "";

    const scoreResult = await scoreInterviewAnswer({
      question: question.question,
      answer: body.answerText,
      questionType: question.questionType,
      level: interview.level,
      persona: interview.persona,
      language: interview.language,
      resumeContext,
    });

    await db.insert(questionScores).values({
      questionId: body.questionId,
      understanding: scoreResult.scores.understanding,
      expression: scoreResult.scores.expression,
      logic: scoreResult.scores.logic,
      depth: scoreResult.scores.depth,
      authenticity: scoreResult.scores.authenticity,
      reflection: scoreResult.scores.reflection,
      overall: scoreResult.scores.overall,
    });

    await db
      .update(interviewQuestions)
      .set({
        feedbackJson: {
          strengths: scoreResult.strengths,
          improvements: scoreResult.improvements,
          advice: scoreResult.advice,
          deepDive: scoreResult.deepDive,
        },
      })
      .where(eq(interviewQuestions.id, body.questionId));

    const answeredQuestions = await db
      .select()
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.interviewId, id),
          isNotNull(interviewQuestions.answeredAt)
        )
      );

    const answeredCount = answeredQuestions.length;
    const moreNeeded = answeredCount < interview.questionCount;

    const allQuestions = await db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, id))
      .orderBy(asc(interviewQuestions.questionIndex));

    const nextExisting = allQuestions.find((q) => !q.answeredAt);

    if (moreNeeded && !nextExisting) {
      const recentAnswered = allQuestions
        .filter((q) => q.answeredAt && q.answerText)
        .slice(-3)
        .map((q) => ({ question: q.question, answer: q.answerText! }));

      const newQuestions = await generateInterviewQuestions({
        resumeData: resumeVersion?.parsedJson,
        resumeText: resumeVersion?.extractedText ?? "",
        level: interview.level,
        type: interview.type,
        language: interview.language,
        persona: interview.persona,
        count: 1,
        history: recentAnswered,
      });

      if (newQuestions.length > 0) {
        const maxIndex = allQuestions.reduce(
          (max, q) => Math.max(max, q.questionIndex),
          0
        );

        await db.insert(interviewQuestions).values({
          interviewId: id,
          questionIndex: maxIndex + 1,
          questionType: newQuestions[0].questionType,
          topic: newQuestions[0].topic,
          question: newQuestions[0].question,
          tip: newQuestions[0].tip,
        });
      }
    }

    const [nextQuestion] = await db
      .select()
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.interviewId, id),
          isNull(interviewQuestions.answeredAt)
        )
      )
      .orderBy(asc(interviewQuestions.questionIndex))
      .limit(1);

    return NextResponse.json({
      score: scoreResult.scores,
      feedback: {
        strengths: scoreResult.strengths,
        improvements: scoreResult.improvements,
        advice: scoreResult.advice,
      },
      nextQuestion: nextQuestion ?? null,
      progress: {
        current: answeredCount,
        total: interview.questionCount,
      },
    });
  } catch (error) {
    console.error("Error submitting answer:", error);
    return NextResponse.json(
      { error: "Failed to submit answer" },
      { status: 500 }
    );
  }
}
