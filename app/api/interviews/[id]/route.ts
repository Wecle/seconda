import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviews, interviewQuestions, questionScores, resumes, resumeVersions } from "@/lib/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";
import type { ParsedResume } from "@/lib/resume/types";

export async function GET(
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
      .select({ interview: interviews, resumeVersion: resumeVersions })
      .from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)));

    const interview = interviewRow?.interview;
    const resumeVersion = interviewRow?.resumeVersion;

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
      resumeSnapshot: resumeVersion
        ? {
            id: resumeVersion.id,
            originalFilename: resumeVersion.originalFilename,
            originalFileUrl: resumeVersion.storedPath,
            parseStatus: resumeVersion.parseStatus,
            parsedData: (resumeVersion.parsedJson as ParsedResume) ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching interview:", error);
    return NextResponse.json(
      { error: "Failed to fetch interview" },
      { status: 500 }
    );
  }
}
