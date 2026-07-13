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
import { isInterviewAgentEnabled } from "@/lib/interview/agent/feature";
import { legacyInterviewReadOnlyResponse } from "@/lib/interview/legacy";

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.json();

    if (rawBody?.configVersion === 2) {
      if (!isInterviewAgentEnabled()) {
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
      const dependencies = createProductionAgentDependencies({ defer: (task) => after(task) });
      const scheduler = createAgentRunScheduler({
        ...dependencies,
        defer: (task) => after(task),
      });
      const result = await createAgentInterview({
        input: {
          ownerUserId: userId,
          resumeVersionId: v2.data.resumeVersionId,
          config: {
            configVersion: 2,
            language: v2.data.language,
            persona: v2.data.persona,
            preference: v2.data.preference,
            preferenceTags: v2.data.preferenceTags,
          },
          idempotencyKey: v2.data.idempotencyKey,
        },
        store: createDrizzleAgentInterviewStore(db),
        repository: dependencies.repository,
        scheduler,
        signal: request.signal,
      });
      return NextResponse.json({ ...result, configVersion: 2 }, { status: 201 });
    }

    return legacyInterviewReadOnlyResponse();
  } catch (error) {
    console.error("Error creating interview:", sanitizeAIError(error));
    return NextResponse.json(
      { error: "Failed to create interview" },
      { status: 500 }
    );
  }
}
