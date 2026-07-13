import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { interviewResumeSnapshots, interviews } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth/session";
import { getPostgresAgentEventWakeHub } from "@/lib/interview/agent/postgres-wake-hub";
import { createDrizzleInterviewAgentRepository } from "@/lib/interview/agent/repository";
import { encodeSseEvent, resolveReplayCursor, streamAgentEvents } from "@/lib/interview/agent/sse";
import { isInterviewAgentEnabled } from "@/lib/interview/agent/feature";

const paramsSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
});
const afterSchema = z.coerce.number().int().min(0).default(0);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  if (!isInterviewAgentEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsedParams = paramsSchema.safeParse(await params);
  const parsedAfter = afterSchema.safeParse(request.nextUrl.searchParams.get("after") ?? 0);
  const parsedLastEventId = afterSchema.safeParse(request.headers.get("last-event-id") ?? 0);
  if (!parsedParams.success || !parsedAfter.success || !parsedLastEventId.success) {
    return NextResponse.json({ error: "Invalid stream cursor" }, { status: 400 });
  }

  const [owned] = await db.select({ id: interviews.id }).from(interviews)
    .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .where(and(eq(interviews.id, parsedParams.data.id), eq(interviewResumeSnapshots.ownerUserId, userId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "Interview not found" }, { status: 404 });

  const repository = createDrizzleInterviewAgentRepository(db);
  const run = await repository.getRun(parsedParams.data.runId);
  if (!run || run.interviewId !== parsedParams.data.id) {
    return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const wakeHub = getPostgresAgentEventWakeHub();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamAgentEvents({
          repository,
          wakeHub,
          runId: run.id,
          afterSequence: resolveReplayCursor(parsedAfter.data, parsedLastEventId.data),
          signal: request.signal,
          heartbeatMs: readPositiveInteger(
            process.env.INTERVIEW_AGENT_HEARTBEAT_MS,
            10_000,
          ),
          fallbackMs: readPositiveInteger(
            process.env.INTERVIEW_AGENT_EVENT_FALLBACK_MS,
            1_500,
          ),
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

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
