import { NextRequest, NextResponse } from "next/server";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { serializeParsedResume } from "@/lib/resume/canonical-text";
import { generateResumeWithAI } from "@/lib/resume/generate-resume";
import { parseGeneratedResumeRequestBody } from "@/lib/resume/generated-resume-request";
import {
  findGeneratedResumeByKey,
  persistGeneratedResume,
} from "@/lib/resume/generated-resume-store";

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseGeneratedResumeRequestBody(request);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          ...(parsed.details ? { details: parsed.details } : {}),
        },
        { status: 400 },
      );
    }

    const existing = await findGeneratedResumeByKey(
      db,
      userId,
      parsed.data.idempotencyKey,
    );
    if (existing) return NextResponse.json(existing);

    const generated = await generateResumeWithAI(parsed.data, {
      abortSignal: request.signal,
    });
    const result = await persistGeneratedResume(db, {
      ownerUserId: userId,
      idempotencyKey: parsed.data.idempotencyKey,
      title: parsed.data.targetRole,
      parsed: generated,
      extractedText: serializeParsedResume(generated),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error generating resume:", sanitizeAIError(error));
    return NextResponse.json(
      { error: "Failed to generate resume" },
      { status: 500 },
    );
  }
}
