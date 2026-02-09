import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  interviews,
  interviewQuestions,
  questionScores,
  resumeVersions,
} from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { generateInterviewReport } from "@/lib/interview";
import type { ParsedResume } from "@/lib/resume/types";

export async function POST(
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

    if (interview.status !== "active") {
      return NextResponse.json(
        { error: "Interview is not active" },
        { status: 400 }
      );
    }

    const questions = await db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, id))
      .orderBy(asc(interviewQuestions.questionIndex));

    const questionsWithScores = await Promise.all(
      questions
        .filter((q) => q.answeredAt && q.answerText)
        .map(async (q) => {
          const [score] = await db
            .select()
            .from(questionScores)
            .where(eq(questionScores.questionId, q.id));

          return { question: q, score };
        })
    );

    const reportQuestions = questionsWithScores
      .filter((qs) => qs.score)
      .map((qs) => ({
        question: qs.question.question,
        answer: qs.question.answerText!,
        scores: {
          understanding: qs.score!.understanding,
          expression: qs.score!.expression,
          logic: qs.score!.logic,
          depth: qs.score!.depth,
          authenticity: qs.score!.authenticity,
          reflection: qs.score!.reflection,
          overall: qs.score!.overall,
        },
      }));

    const [resumeVersion] = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.id, interview.resumeVersionId));

    const resume = resumeVersion?.parsedJson as ParsedResume | null;
    const resumeSummary = resume
      ? `${resume.name} - ${resume.title}. Skills: ${resume.skills.join(", ")}`
      : "";

    const report = await generateInterviewReport({
      questions: reportQuestions,
      level: interview.level,
      type: interview.type,
      language: interview.language,
      resumeSummary,
    });

    await db
      .update(interviews)
      .set({
        status: "completed",
        completedAt: new Date(),
        overallScore: report.overallScore,
        reportJson: report,
        updatedAt: new Date(),
      })
      .where(eq(interviews.id, id));

    return NextResponse.json(report);
  } catch (error) {
    console.error("Error completing interview:", error);
    return NextResponse.json(
      { error: "Failed to complete interview" },
      { status: 500 }
    );
  }
}
