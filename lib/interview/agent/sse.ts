import type { AgentStreamEvent } from "./contracts";
import type { InterviewAgentRepository } from "./repository";

export function encodeSseEvent(event: AgentStreamEvent) {
  if (event.type === "heartbeat") {
    return `event: heartbeat\ndata: ${JSON.stringify({ serverTime: event.serverTime })}\n\n`;
  }
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
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
    if (!run || run.status !== "running") return;
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

function abortableWait(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}
