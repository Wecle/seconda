import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { interviews, interviewQuestions, resumeVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateInterviewQuestions } from "@/lib/interview";

const createSchema = z.object({
  level: z.string(),
  type: z.string(),
  language: z.string(),
  questionCount: z.number().int().min(5).max(30),
  persona: z.string(),
  resumeVersionId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = createSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;

    const [resumeVersion] = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.id, body.resumeVersionId));

    if (!resumeVersion) {
      return NextResponse.json(
        { error: "Resume version not found" },
        { status: 404 }
      );
    }

    if (resumeVersion.parseStatus !== "parsed") {
      return NextResponse.json(
        { error: "Resume has not been parsed yet" },
        { status: 400 }
      );
    }

    const [interview] = await db
      .insert(interviews)
      .values({
        resumeVersionId: body.resumeVersionId,
        level: body.level,
        type: body.type,
        language: body.language,
        questionCount: body.questionCount,
        persona: body.persona,
        status: "active",
      })
      .returning();

    const initialCount = Math.min(3, body.questionCount);

    const generatedQuestions = await generateInterviewQuestions({
      resumeData: resumeVersion.parsedJson,
      resumeText: resumeVersion.extractedText ?? "",
      level: body.level,
      type: body.type,
      language: body.language,
      persona: body.persona,
      count: initialCount,
    });

    await db.insert(interviewQuestions).values(
      generatedQuestions.map((q, i) => ({
        interviewId: interview.id,
        questionIndex: i + 1,
        questionType: q.questionType,
        topic: q.topic,
        question: q.question,
        tip: q.tip,
      }))
    );

    return NextResponse.json({
      interviewId: interview.id,
      questionCount: body.questionCount,
    });
  } catch (error) {
    console.error("Error creating interview:", error);
    return NextResponse.json(
      { error: "Failed to create interview" },
      { status: 500 }
    );
  }
}
