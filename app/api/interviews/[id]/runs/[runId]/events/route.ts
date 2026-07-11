import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { interviews, resumes, resumeVersions } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { createDrizzleInterviewAgentRepository } from "@/lib/interview/agent/repository";
import { encodeSseEvent, pollAgentEvents } from "@/lib/interview/agent/sse";

const paramsSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
});
const afterSchema = z.coerce.number().int().min(0).default(0);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  if (process.env.INTERVIEW_AGENT_V2_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsedParams = paramsSchema.safeParse(await params);
  const parsedAfter = afterSchema.safeParse(request.nextUrl.searchParams.get("after") ?? 0);
  if (!parsedParams.success || !parsedAfter.success) {
    return NextResponse.json({ error: "Invalid stream cursor" }, { status: 400 });
  }

  const [owned] = await db.select({ id: interviews.id }).from(interviews)
    .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
    .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
    .where(and(eq(interviews.id, parsedParams.data.id), eq(resumes.userId, userId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });

  const repository = createDrizzleInterviewAgentRepository(db);
  const run = await repository.getRun(parsedParams.data.runId);
  if (!run || run.interviewId !== parsedParams.data.id) {
    return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of pollAgentEvents({
          repository,
          runId: run.id,
          afterSequence: parsedAfter.data,
          signal: request.signal,
        })) {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
