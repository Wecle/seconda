import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumes } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";

const resumeInterviewSettingsSchema = z.object({
  language: z.enum(["zh", "en", "es", "de"]),
  persona: z.enum(["friendly", "standard", "stressful"]),
  interviewType: z.enum(["behavioral", "technical", "mixed"]),
  targetLevel: z.enum(["Junior", "Mid", "Senior"]),
  targetRole: z.string().trim().max(100).optional(),
  preference: z.string().trim().max(1_000).default(""),
  preferenceTags: z.array(z.string().trim().min(1).max(50)).max(3).default([]),
  targetRoundCount: z.number().int().min(1).max(20),
});

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
    if (!id) {
      return NextResponse.json({ error: "Resume ID is required" }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsed = resumeInterviewSettingsSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid interview settings", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const [updatedResume] = await db
      .update(resumes)
      .set({
        interviewSettings: parsed.data,
        updatedAt: new Date(),
      })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .returning();

    if (!updatedResume) {
      return NextResponse.json(
        { error: "Resume not found or unauthorized" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      interviewSettings: updatedResume.interviewSettings,
    });
  } catch (error) {
    console.error("Error updating interview settings:", error);
    return NextResponse.json(
      { error: "Failed to update interview settings" },
      { status: 500 },
    );
  }
}
