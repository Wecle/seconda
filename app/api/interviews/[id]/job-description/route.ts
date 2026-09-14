import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { interviews, interviewJobSnapshots } from "@/lib/db/schema";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();

export async function handleGetInterviewJobSnapshot(
  input: { interviewId: string; userId: string },
  dependencies: { database?: typeof db } = {},
) {
  const database = dependencies.database ?? db;
  const parsedId = uuidSchema.safeParse(input.interviewId);
  if (!parsedId.success) {
    return { status: 404 as const, body: { error: "Interview not found" } };
  }

  const [ownedInterview] = await database
    .select({ id: interviews.id })
    .from(interviews)
    .where(and(eq(interviews.id, parsedId.data), eq(interviews.userId, input.userId)))
    .limit(1);

  if (!ownedInterview) {
    return { status: 404 as const, body: { error: "Interview not found" } };
  }

  const [snapshot] = await database
    .select()
    .from(interviewJobSnapshots)
    .where(eq(interviewJobSnapshots.interviewId, parsedId.data))
    .limit(1);

  return { status: 200 as const, body: { snapshot: snapshot ?? null } };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const outcome = await handleGetInterviewJobSnapshot({
      interviewId: id,
      userId,
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    console.error("Failed to load interview job description snapshot:", error);
    return NextResponse.json(
      { error: "Failed to load interview job description snapshot" },
      { status: 500 },
    );
  }
}
