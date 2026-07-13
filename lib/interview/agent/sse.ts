import type { AgentStreamEvent } from "./contracts";
import type { AgentEventWakeHub } from "./postgres-wake-hub";
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

export async function* streamAgentEvents(options: {
  repository: InterviewAgentRepository;
  wakeHub: AgentEventWakeHub;
  runId: string;
  afterSequence: number;
  signal: AbortSignal;
  heartbeatMs?: number;
  fallbackMs?: number;
  now?: () => Date;
}): AsyncGenerator<AgentStreamEvent> {
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const fallbackMs = options.fallbackMs ?? 1_500;
  const now = options.now ?? (() => new Date());
  let cursor = options.afterSequence;
  let lastDeliveryAt = now().getTime();

  while (!options.signal.aborted) {
    const events = await options.repository.listEvents(
      options.runId,
      cursor,
      { visibility: "public" },
    );
    for (const event of events) {
      cursor = event.sequence;
      lastDeliveryAt = now().getTime();
      yield event;
    }
    const run = await options.repository.getRun(options.runId);
    if (!run) return;
    if (run.status !== "running") {
      yield* terminalCompatibilityDelivery(
        options.repository,
        options.runId,
        cursor,
        run,
      );
      return;
    }

    let result;
    try {
      result = await options.wakeHub.waitForRun(
        options.runId,
        cursor,
        options.signal,
        fallbackMs,
      );
    } catch {
      if (options.signal.aborted) return;
      result = "timeout" as const;
    }
    if (result === "timeout" && now().getTime() - lastDeliveryAt >= heartbeatMs) {
      const serverTime = now();
      lastDeliveryAt = serverTime.getTime();
      yield { type: "heartbeat", serverTime: serverTime.toISOString() };
    }
  }
}

async function* terminalCompatibilityDelivery(
  repository: InterviewAgentRepository,
  runId: string,
  afterSequence: number,
  run: NonNullable<Awaited<ReturnType<InterviewAgentRepository["getRun"]>>>,
): AsyncGenerator<AgentStreamEvent> {
  const remainingEvents = await repository.listEvents(
    runId,
    afterSequence,
    { visibility: "public" },
  );
  for (const event of remainingEvents) yield event;
  if (remainingEvents.some(isTerminalEvent)) return;

  const publicEvents = await repository.listEvents(runId, 0, { visibility: "public" });
  const hasTerminalEvent = publicEvents.some(isTerminalEvent);
  if (hasTerminalEvent) return;
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

function isTerminalEvent(event: AgentStreamEvent) {
  return event.type === "run_completed" || event.type === "run_failed";
}
