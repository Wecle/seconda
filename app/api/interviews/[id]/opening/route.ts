import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { executeInterviewOpening } from "@/lib/interview/application/execute-opening";
import { getInterviewRoom } from "@/lib/interview/application/get-interview-room";
import { loadOwnedOpeningRunReference } from "@/lib/interview/persistence/repository";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();
const encoder = new TextEncoder();

function encodeEvent(value: unknown) {
  return encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
}

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

  let clientClosed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const execution = executeInterviewOpening({
        userId,
        openingRunId: reference.openingRunId,
      }).then(
        () => ({ ok: true as const }),
        () => ({ ok: false as const }),
      );
      let previousView = "";

      try {
        while (!clientClosed) {
          const view = await getInterviewRoom({ userId, interviewId: parsedId.data });
          if (!view) throw new Error("Interview disappeared while opening");
          const serialized = JSON.stringify(view);
          if (serialized !== previousView) {
            previousView = serialized;
            controller.enqueue(encodeEvent({ type: "room", view }));
          }

          const outcome = await Promise.race([
            execution,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
          ]);
          if (outcome) {
            const finalView = await getInterviewRoom({ userId, interviewId: parsedId.data });
            if (finalView) {
              const finalSerialized = JSON.stringify(finalView);
              if (finalSerialized !== previousView) {
                controller.enqueue(encodeEvent({ type: "room", view: finalView }));
              }
            }
            controller.enqueue(encodeEvent({ type: "complete", ok: outcome.ok }));
            break;
          }
        }
      } catch (error) {
        console.error("Failed to stream interview opening", error instanceof Error ? error.name : "Unknown error");
        if (!clientClosed) controller.enqueue(encodeEvent({ type: "complete", ok: false }));
      } finally {
        if (!clientClosed) {
          clientClosed = true;
          controller.close();
        }
      }
    },
    cancel() {
      clientClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
