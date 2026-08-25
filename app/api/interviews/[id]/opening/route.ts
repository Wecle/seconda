import { z } from "zod";
import { after } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { executeInterviewOpening } from "@/lib/interview/application/execute-opening";
import { loadOwnedOpeningRunReference } from "@/lib/interview/persistence/repository";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) return Response.json({ error: "Interview not found" }, { status: 404 });

  const reference = await loadOwnedOpeningRunReference({
    database: db,
    userId,
    interviewId: parsedId.data,
  });
  if (!reference) return Response.json({ error: "Interview not found" }, { status: 404 });

  after(async () => {
    await executeInterviewOpening({
      userId,
      openingRunId: reference.openingRunId,
    }).catch((error) => {
      console.error("Failed to execute interview opening", error instanceof Error ? error.name : "Unknown error");
    });
  });
  return Response.json({ runId: reference.openingRunId }, { status: 202 });
}
