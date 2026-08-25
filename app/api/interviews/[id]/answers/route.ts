import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { executeInterviewTurn } from "@/lib/interview/application/execute-turn";
import { getInterviewRoom } from "@/lib/interview/application/get-interview-room";
import { submitInterviewAnswer } from "@/lib/interview/application/submit-answer";
import { InterviewApplicationError } from "@/lib/interview/domain/errors";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();
const encoder = new TextEncoder();

function encodeEvent(value: unknown) {
  return encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
}

function applicationErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  if (error instanceof z.ZodError) return Response.json({ error: "Invalid answer" }, { status: 400 });
  if (error instanceof InterviewApplicationError) {
    if (error.code === "INTERVIEW_NOT_FOUND") return Response.json({ error: "Interview not found" }, { status: 404 });
    return Response.json({ error: error.code }, { status: 409 });
  }
  console.error("Failed to submit interview answer", error);
  return Response.json({ error: "Failed to submit answer" }, { status: 500 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) return Response.json({ error: "Interview not found" }, { status: 404 });
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
  let submitted: Awaited<ReturnType<typeof submitInterviewAnswer>>;
  try {
    submitted = await submitInterviewAnswer({
      userId,
      interviewId: parsedId.data,
      idempotencyKey,
      request: await request.json(),
    });
  } catch (error) {
    return applicationErrorResponse(error);
  }

  let clientClosed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const execution = executeInterviewTurn({
        userId,
        interviewRunId: submitted.run.id,
      }).then(
        () => ({ ok: true as const }),
        () => ({ ok: false as const }),
      );
      let previousView = "";
      try {
        while (!clientClosed) {
          const view = await getInterviewRoom({ userId, interviewId: parsedId.data });
          if (!view) throw new Error("Interview disappeared while executing a turn");
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
              if (finalSerialized !== previousView) controller.enqueue(encodeEvent({ type: "room", view: finalView }));
            }
            controller.enqueue(encodeEvent({ type: "complete", ok: outcome.ok }));
            break;
          }
        }
      } catch (error) {
        console.error("Failed to stream interview turn", error instanceof Error ? error.name : "Unknown error");
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
