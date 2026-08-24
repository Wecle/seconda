import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { DEFAULT_AGENT_MAX_STEPS, DEFAULT_AGENT_TIMEOUT_MS } from "@/lib/agent/prompt";
import {
  appendAgentEvent,
  beginAgentRun,
  renameAgentSession,
  settleAgentRun,
} from "@/lib/agent/repository";
import { registerActiveRun } from "@/lib/agent/run-registry";
import { runAgent, safeAgentError } from "@/lib/agent/runtime";
import type { AgentEvent, AgentEventSink } from "@/lib/agent/types";

export const runtime = "nodejs";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
});

function encodeEvent(event: AgentEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Message is required" }, { status: 400 });
  const { id: sessionId } = await params;
  const started = await beginAgentRun({ userId, sessionId, maxSteps: DEFAULT_AGENT_MAX_STEPS });
  if (!started) {
    return Response.json({ error: "Session not found or already running" }, { status: 409 });
  }

  const { session, run } = started;
  let userEvent: AgentEvent;
  try {
    if (session.title === "New agent task") {
      await renameAgentSession(userId, sessionId, parsed.data.message.slice(0, 60));
    }
    const userMessage = { role: "user" as const, content: parsed.data.message };
    userEvent = await appendAgentEvent({
      sessionId,
      runId: run.id,
      type: "user_message",
      payload: { message: userMessage, trust: "untrusted-data", source: "human" },
    });
  } catch (error) {
    const message = safeAgentError(error);
    await settleAgentRun({
      runId: run.id,
      sessionId,
      status: "failed",
      errorMessage: message,
      terminalEvent: { type: "run_failed", payload: { message } },
    });
    return Response.json({ error: message }, { status: 500 });
  }

  const controller = new AbortController();
  const unregister = registerActiveRun(run.id, controller);
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(DEFAULT_AGENT_TIMEOUT_MS),
  ]);

  let clientClosed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const enqueue = (event: AgentEvent) => {
        if (!clientClosed) streamController.enqueue(encodeEvent(event));
      };
      enqueue(userEvent);
      const events: AgentEventSink = {
        append: async (type, payload) => {
          const event = await appendAgentEvent({ sessionId, runId: run.id, type, payload });
          enqueue(event);
          return event;
        },
        publish: enqueue,
      };

      try {
        const usage = await runAgent({
          sessionId,
          runId: run.id,
          model: session.model,
          systemPrompt: session.systemPrompt,
          workspaceRoot: session.workspaceRoot,
          maxSteps: run.maxSteps,
          signal,
          events,
        });
        const event = await settleAgentRun({
          runId: run.id,
          sessionId,
          status: "completed",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          terminalEvent: { type: "run_completed", payload: { usage } },
        });
        enqueue(event);
      } catch (error) {
        const reason = signal.reason;
        const cancelled = reason instanceof DOMException && reason.name === "AbortError";
        const message = safeAgentError(error);
        try {
          const event = await settleAgentRun({
            runId: run.id,
            sessionId,
            status: cancelled ? "cancelled" : "failed",
            errorMessage: message,
            terminalEvent: {
              type: cancelled ? "run_cancelled" : "run_failed",
              payload: { message },
            },
          });
          enqueue(event);
        } catch (settleError) {
          console.error("Failed to settle agent run", settleError);
          if (!clientClosed) {
            clientClosed = true;
            streamController.error(new Error("Failed to persist agent run status"));
          }
        }
      } finally {
        unregister();
        if (!clientClosed) {
          clientClosed = true;
          streamController.close();
        }
      }
    },
    cancel() {
      clientClosed = true;
      controller.abort(new DOMException("Client disconnected", "AbortError"));
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
