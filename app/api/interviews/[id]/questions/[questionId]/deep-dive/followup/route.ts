import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
import { generateFollowUp } from "@/lib/interview";

const bodySchema = z.object({
  action: z.enum(["start", "answer"]),
  answerText: z.string().optional(),
});

type RouteParams = { params: Promise<{ id: string; questionId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, questionId } = await params;

    const rawBody = await request.json();
    const parsed = bodySchema.safeParse(rawBody);
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

    if (!interviewRow) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const interview = interviewRow.interview;

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

    let [session] = await db
      .select()
      .from(deepDiveSessions)
      .where(
        and(
          eq(deepDiveSessions.questionId, questionId),
          eq(deepDiveSessions.mode, "followup")
        )
      );

    if (!session) {
      [session] = await db
        .insert(deepDiveSessions)
        .values({ questionId, mode: "followup" })
        .returning();
    }

    const existingMessages = await db
      .select()
      .from(deepDiveMessages)
      .where(eq(deepDiveMessages.sessionId, session.id))
      .orderBy(asc(deepDiveMessages.createdAt));

    const feedback = question.feedbackJson as Record<string, unknown> | null;
    const improvements = (feedback?.improvements as string[]) ?? [];

    if (body.action === "start") {
      if (existingMessages.length > 0) {
        return NextResponse.json({ session, messages: existingMessages });
      }

      const result = await generateFollowUp({
        question: question.question,
        originalAnswer: question.answerText || "",
        improvements,
        history: [],
        language: interview.language,
      });

      const [newMsg] = await db
        .insert(deepDiveMessages)
        .values({
          sessionId: session.id,
          role: "assistant",
          content: result.question,
          payload: result,
        })
        .returning();

      return NextResponse.json({ session, messages: [newMsg] });
    }

    if (body.action === "answer") {
      if (!body.answerText) {
        return NextResponse.json(
          { error: "answerText is required for answer action" },
          { status: 400 }
        );
      }

      const [userMsg] = await db
        .insert(deepDiveMessages)
        .values({
          sessionId: session.id,
          role: "user",
          content: body.answerText,
        })
        .returning();

      const allMessages = [...existingMessages, userMsg];

      const history = allMessages.map((m) => ({
        role: m.role as "assistant" | "user",
        content:
          m.role === "user"
            ? m.content || ""
            : (m.payload as Record<string, unknown>)?.question as string || m.content || "",
      }));

      const result = await generateFollowUp({
        question: question.question,
        originalAnswer: question.answerText || "",
        improvements,
        history,
        language: interview.language,
      });

      const [assistantMsg] = await db
        .insert(deepDiveMessages)
        .values({
          sessionId: session.id,
          role: "assistant",
          content: result.question,
          payload: result,
        })
        .returning();

      return NextResponse.json({
        session,
        messages: [...allMessages, assistantMsg],
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error in follow-up deep dive:", error);
    return NextResponse.json(
      { error: "Failed to process follow-up" },
      { status: 500 }
    );
  }
}
