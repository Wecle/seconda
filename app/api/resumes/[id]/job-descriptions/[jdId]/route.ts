import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resumes, resumeJobDescriptions } from "@/lib/db/schema";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();

export async function handleDeleteResumeJobDescription(
  input: { resumeId: string; jdId: string; userId: string },
  dependencies: { database?: typeof db; blobToken?: string } = {},
) {
  const database = dependencies.database ?? db;
  const parsedResumeId = uuidSchema.safeParse(input.resumeId);
  const parsedJdId = uuidSchema.safeParse(input.jdId);

  if (!parsedResumeId.success || !parsedJdId.success) {
    return { status: 404 as const, body: { error: "Job description not found" } };
  }

  const [ownedResume] = await database
    .select({ id: resumes.id, interviewSettings: resumes.interviewSettings })
    .from(resumes)
    .where(and(eq(resumes.id, parsedResumeId.data), eq(resumes.userId, input.userId)))
    .limit(1);

  if (!ownedResume) {
    return { status: 404 as const, body: { error: "Resume not found" } };
  }

  const [existingJd] = await database
    .select({ id: resumeJobDescriptions.id, storedPath: resumeJobDescriptions.storedPath })
    .from(resumeJobDescriptions)
    .where(
      and(
        eq(resumeJobDescriptions.id, parsedJdId.data),
        eq(resumeJobDescriptions.resumeId, parsedResumeId.data),
        eq(resumeJobDescriptions.userId, input.userId),
      ),
    )
    .limit(1);

  if (!existingJd) {
    return { status: 404 as const, body: { error: "Job description not found" } };
  }

  await database
    .delete(resumeJobDescriptions)
    .where(
      and(
        eq(resumeJobDescriptions.id, parsedJdId.data),
        eq(resumeJobDescriptions.resumeId, parsedResumeId.data),
        eq(resumeJobDescriptions.userId, input.userId),
      ),
    );

  if (ownedResume.interviewSettings?.defaultJobDescriptionId === parsedJdId.data) {
    const updatedSettings = {
      ...ownedResume.interviewSettings,
      defaultJobDescriptionId: undefined,
    };
    await database
      .update(resumes)
      .set({
        interviewSettings: updatedSettings,
        updatedAt: new Date(),
      })
      .where(eq(resumes.id, ownedResume.id));
  }

  if (existingJd.storedPath) {
    try {
      const blobToken = (
        dependencies.blobToken ??
        process.env.BLOB_READ_WRITE_TOKEN
      )?.replace(/^["']|["']$/g, "").trim();
      await del(existingJd.storedPath, blobToken ? { token: blobToken } : undefined);
    } catch (blobErr) {
      console.error("JD deleted from database but blob cleanup failed:", blobErr);
    }
  }

  return { status: 200 as const, body: { success: true } };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; jdId: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, jdId } = await params;
    const outcome = await handleDeleteResumeJobDescription({
      resumeId: id,
      jdId,
      userId,
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    console.error("Failed to delete job description:", error);
    return NextResponse.json({ error: "Failed to delete job description" }, { status: 500 });
  }
}
