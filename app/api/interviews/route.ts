import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { createInterview } from "@/lib/interview/application/create-interview";
import { executeInterviewOpening } from "@/lib/interview/application/execute-opening";
import {
  createInterviewRequestSchema,
  creationIdempotencyKeySchema,
} from "@/lib/interview/domain/create-interview";
import { InterviewApplicationError } from "@/lib/interview/domain/errors";

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idempotencyKey = creationIdempotencyKeySchema.safeParse(
    request.headers.get("Idempotency-Key"),
  );
  const body = createInterviewRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!idempotencyKey.success || !body.success) {
    return NextResponse.json({ error: "Invalid interview settings" }, { status: 400 });
  }

  try {
    const result = await createInterview({
      userId,
      idempotencyKey: idempotencyKey.data,
      request: body.data,
    });
    const opening = await executeInterviewOpening({
      userId,
      openingRunId: result.openingRunId,
    });
    return NextResponse.json({
      interviewId: result.interviewId,
      status: opening.status,
      replayed: result.replayed,
      question: opening.question,
    }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof InterviewApplicationError) {
      if (error.code === "INTERVIEW_IDEMPOTENCY_CONFLICT") {
        return NextResponse.json({ error: error.code }, { status: 409 });
      }
      if (error.code === "RESUME_VERSION_NOT_FOUND") {
        return NextResponse.json({ error: error.code }, { status: 404 });
      }
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid interview settings" }, { status: 400 });
    }
    console.error("Failed to create interview", sanitizeAIError(error));
    return NextResponse.json({ error: "Failed to create interview" }, { status: 500 });
  }
}
