import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  interviews,
  interviewQuestions,
  questionScores,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { generateInterviewReport } from "@/lib/interview";
import type { ParsedResume } from "@/lib/resume/types";
import { getCurrentUserId } from "@/lib/auth/session";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const scoredQuestions = questions.filter((q) => q.answeredAt && q.answerText?.trim());
    const maxRetries = 15;
    let reportQuestions: {
      question: string;
      answer: string;
      scores: {
        understanding: number;
        expression: number;
        logic: number;
        depth: number;
        authenticity: number;
        reflection: number;
        overall: number;
      };
    }[] = [];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const questionsWithScores = await Promise.all(
        scoredQuestions.map(async (q) => {
          const [score] = await db
            .select()
            .from(questionScores)
            .where(eq(questionScores.questionId, q.id));
          return { question: q, score };
        })
      );

      reportQuestions = questionsWithScores
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

      if (reportQuestions.length >= scoredQuestions.length) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

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
