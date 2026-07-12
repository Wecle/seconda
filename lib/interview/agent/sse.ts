import type { AgentStreamEvent } from "./contracts";
import type { InterviewAgentRepository } from "./repository";

export function encodeSseEvent(event: AgentStreamEvent) {
  if (event.type === "heartbeat") {
    return `event: heartbeat\ndata: ${JSON.stringify({ serverTime: event.serverTime })}\n\n`;
  }
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

export function resolveReplayCursor(queryCursor: number, lastEventId: number) {
  return Math.max(queryCursor, lastEventId);
}

export async function* pollAgentEvents(options: {
  repository: InterviewAgentRepository;
  runId: string;
  afterSequence: number;
  signal: AbortSignal;
  heartbeatMs?: number;
  pollMs?: number;
  now?: () => Date;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): AsyncGenerator<AgentStreamEvent> {
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const pollMs = options.pollMs ?? 750;
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? abortableWait;
  let cursor = options.afterSequence;
  let lastDeliveryAt = now().getTime();

  while (!options.signal.aborted) {
    const events = await options.repository.listEvents(options.runId, cursor);
    for (const event of events) {
      cursor = event.sequence;
      lastDeliveryAt = now().getTime();
      yield event;
    }
    const run = await options.repository.getRun(options.runId);
    if (!run) return;
    if (run.status !== "running") {
      const allEvents = await options.repository.listEvents(options.runId, 0);
      const hasTerminalEvent = allEvents.some(
        (event) => event.type === "run_completed" || event.type === "run_failed",
      );
      if (!hasTerminalEvent) {
        yield {
          type: run.status === "completed" ? "run_completed" : "run_failed",
          sequence: run.lastEventSequence + 1,
          payload: {
            runId: run.id,
            exitReason: run.exitReason ?? "aborted_streaming",
            retryable: false,
            userMessage: run.status === "completed"
              ? "本轮处理已完成。"
              : "本轮处理已终止，请重试。",
          },
        };
      }
      return;
    }
    if (now().getTime() - lastDeliveryAt >= heartbeatMs) {
      lastDeliveryAt = now().getTime();
      yield { type: "heartbeat", serverTime: now().toISOString() };
    }
    try {
      await wait(pollMs, options.signal);
    } catch {
      return;
    }
  }
}

export function abortableWait(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let settled = false;
    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    }
    function onAbort() {
      finish(() => {
        clearTimeout(timeout);
        reject(signal.reason);
      });
    }
    const timeout = setTimeout(() => finish(resolve), delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
