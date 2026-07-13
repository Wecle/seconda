import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { createAgentInterviewRequestSchema } from "@/lib/interview/agent/api-contracts";
import { createProductionAgentDependencies } from "@/lib/interview/agent/composition";
import { createDrizzleAgentInterviewStore } from "@/lib/interview/agent/drizzle-store";
import { createAgentInterview } from "@/lib/interview/agent/service";
import { createAgentRunScheduler } from "@/lib/interview/agent/worker";

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.json();

    const parsed = createAgentInterviewRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const [ownedResume] = await db
      .select()
      .from(resumeVersions)
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(
        eq(resumeVersions.id, parsed.data.resumeVersionId),
        eq(resumes.userId, userId),
      ));
    if (!ownedResume || ownedResume.resume_versions.parseStatus !== "parsed") {
      return NextResponse.json(
        { error: "Parsed resume version not found" },
        { status: 404 },
      );
    }
    const dependencies = createProductionAgentDependencies({ defer: (task) => after(task) });
    const scheduler = createAgentRunScheduler({
      ...dependencies,
      defer: (task) => after(task),
    });
    const result = await createAgentInterview({
      input: {
        ownerUserId: userId,
        resumeVersionId: parsed.data.resumeVersionId,
        config: {
          configVersion: 2,
          language: parsed.data.language,
          persona: parsed.data.persona,
          preference: parsed.data.preference,
          preferenceTags: parsed.data.preferenceTags,
        },
        idempotencyKey: parsed.data.idempotencyKey,
      },
      store: createDrizzleAgentInterviewStore(db),
      repository: dependencies.repository,
      scheduler,
      signal: request.signal,
    });
    return NextResponse.json({ ...result, configVersion: 2 }, { status: 201 });
  } catch (error) {
    console.error("Error creating interview:", sanitizeAIError(error));
    return NextResponse.json(
      { error: "Failed to create interview" },
      { status: 500 }
    );
  }
}
