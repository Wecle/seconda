import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import { createInterview } from "@/lib/interview/application/create-interview";
import {
  createInterviewRequestSchema,
  creationIdempotencyKeySchema,
} from "@/lib/interview/domain/create-interview";
import { InterviewApplicationError } from "@/lib/interview/domain/errors";

import { createInterviewRateLimiter } from "@/lib/interview/application/rate-limit";

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitResult = createInterviewRateLimiter.check(userId);
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(limitResult.retryAfterSeconds ?? 60),
        },
      },
    );
  }

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
    return NextResponse.json({
      interviewId: result.interviewId,
      status: result.status,
      replayed: result.replayed,
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
