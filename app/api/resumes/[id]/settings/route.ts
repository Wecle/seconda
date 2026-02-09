import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  interviewConfigSchema,
  normalizeInterviewConfig,
} from "@/lib/interview/settings";
import { getCurrentUserId } from "@/lib/auth/session";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const payload = await request.json();
    const parsed = interviewConfigSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid interview settings." },
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(resumes)
      .set({
        interviewSettings: parsed.data,
        updatedAt: new Date(),
      })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .returning({
        id: resumes.id,
        interviewSettings: resumes.interviewSettings,
      });

    if (!updated) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: updated.id,
      interviewSettings: normalizeInterviewConfig(updated.interviewSettings),
    });
  } catch (error) {
    console.error("Error saving interview settings:", error);
    return NextResponse.json(
      { error: "Failed to save interview settings" },
      { status: 500 },
    );
  }
}
