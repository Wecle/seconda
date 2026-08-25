const encoder = new TextEncoder();

function parseCursor(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolveInterviewEventCursor(input: {
  after: string | null;
  lastEventId: string | null;
  current: number;
}) {
  const after = parseCursor(input.after);
  const lastEventId = parseCursor(input.lastEventId);
  if (after === null || lastEventId === null) return { ok: false as const, reason: "invalid" as const };
  const cursor = Math.max(after, lastEventId);
  if (cursor > input.current) return { ok: false as const, reason: "ahead" as const };
  return { ok: true as const, cursor };
}

export function encodeInterviewRoomEvent(cursor: number, view: unknown) {
  return encoder.encode(`id: ${cursor}\nevent: room\ndata: ${JSON.stringify({ type: "room", view })}\n\n`);
}

export function createInterviewEventStream<T>(input: {
  cursor: number;
  signal: AbortSignal;
  loadSnapshot(): Promise<{ cursor: number; view: T } | null>;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}) {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = input.cursor;
      let heartbeatAt = Date.now();
      try {
        while (!cancelled && !input.signal.aborted) {
          const snapshot = await input.loadSnapshot();
          if (!snapshot) break;
          if (snapshot.cursor > cursor) {
            cursor = snapshot.cursor;
            controller.enqueue(encodeInterviewRoomEvent(cursor, snapshot.view));
            heartbeatAt = Date.now();
          } else if (Date.now() - heartbeatAt >= (input.heartbeatIntervalMs ?? 15_000)) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            heartbeatAt = Date.now();
          }
          await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? 250));
        }
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
