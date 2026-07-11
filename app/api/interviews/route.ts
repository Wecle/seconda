import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { interviews, interviewQuestions, resumes, resumeVersions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { generateInterviewQuestions } from "@/lib/interview";
import { getCurrentUserId } from "@/lib/auth/session";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { randomUUID } from "node:crypto";
import { createAgentInterviewRequestSchema } from "@/lib/interview/agent/api-contracts";
import { createProductionAgentDependencies } from "@/lib/interview/agent/composition";
import { createDrizzleAgentInterviewStore } from "@/lib/interview/agent/drizzle-store";
import { createAgentInterview } from "@/lib/interview/agent/service";
import { createAgentRunScheduler } from "@/lib/interview/agent/worker";

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
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.json();

    if (rawBody?.configVersion === 2) {
      if (process.env.INTERVIEW_AGENT_V2_ENABLED !== "true") {
        return NextResponse.json(
          { error: "Agent interviews are not enabled" },
          { status: 404 },
        );
      }
      const v2 = createAgentInterviewRequestSchema.safeParse(rawBody);
      if (!v2.success) {
        return NextResponse.json(
          { error: "Invalid request body", details: v2.error.flatten() },
          { status: 400 },
        );
      }
      const [ownedResume] = await db
        .select()
        .from(resumeVersions)
        .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
        .where(and(
          eq(resumeVersions.id, v2.data.resumeVersionId),
          eq(resumes.userId, userId),
        ));
      if (!ownedResume || ownedResume.resume_versions.parseStatus !== "parsed") {
        return NextResponse.json(
          { error: "Parsed resume version not found" },
          { status: 404 },
        );
      }
      const dependencies = createProductionAgentDependencies();
      const scheduler = createAgentRunScheduler({
        ...dependencies,
        defer: (task) => after(task),
      });
      const result = await createAgentInterview({
        input: {
          resumeVersionId: v2.data.resumeVersionId,
          config: {
            configVersion: 2,
            language: v2.data.language,
            persona: v2.data.persona,
            preference: v2.data.preference,
            preferenceTags: v2.data.preferenceTags,
          },
          idempotencyKey: `create:${randomUUID()}`,
        },
        store: createDrizzleAgentInterviewStore(db),
        repository: dependencies.repository,
        scheduler,
        signal: request.signal,
      });
      return NextResponse.json({ ...result, configVersion: 2 }, { status: 201 });
    }

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
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(
        and(
          eq(resumeVersions.id, body.resumeVersionId),
          eq(resumes.userId, userId),
        ),
      );

    if (!resumeVersion) {
      return NextResponse.json(
        { error: "Resume version not found" },
        { status: 404 }
      );
    }

    if (resumeVersion.resume_versions.parseStatus !== "parsed") {
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
      resumeData: resumeVersion.resume_versions.parsedJson,
      resumeText: resumeVersion.resume_versions.extractedText ?? "",
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
    console.error("Error creating interview:", sanitizeAIError(error));
    return NextResponse.json(
      { error: "Failed to create interview" },
      { status: 500 }
    );
  }
}
