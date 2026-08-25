import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { getInterviewRoomEventSnapshot } from "@/lib/interview/application/get-interview-room";
import { createInterviewEventStream, resolveInterviewEventCursor } from "@/lib/interview/application/interview-event-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const interviewIdSchema = z.string().uuid();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) return Response.json({ error: "Interview not found" }, { status: 404 });
  const url = new URL(request.url);
  const initial = await getInterviewRoomEventSnapshot({ userId, interviewId: parsedId.data });
  if (!initial) return Response.json({ error: "Interview not found" }, { status: 404 });
  const resolvedCursor = resolveInterviewEventCursor({
    after: url.searchParams.get("after"),
    lastEventId: request.headers.get("Last-Event-ID"),
    current: initial.cursor,
  });
  if (!resolvedCursor.ok) return Response.json({
    error: resolvedCursor.reason === "ahead" ? "Event cursor is ahead of the session" : "Invalid event cursor",
  }, { status: 400 });

  const stream = createInterviewEventStream({
    cursor: resolvedCursor.cursor,
    signal: request.signal,
    loadSnapshot: () => getInterviewRoomEventSnapshot({ userId, interviewId: parsedId.data }),
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
