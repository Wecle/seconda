const naturalBoundaryPattern = /[。！？.!?\n]/u;

type TimerHandle = ReturnType<typeof setTimeout>;

export type EventCoalescer = {
  append(text: string): Promise<void>;
  flush(): Promise<void>;
  idle(): Promise<void>;
  discard(): Promise<void>;
  dispose(): Promise<void>;
};

export function createEventCoalescer(options: {
  write: (text: string) => Promise<void>;
  intervalMs?: number;
  maxChars?: number;
  schedule?: (delayMs: number, callback: () => void) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}): EventCoalescer {
  const intervalMs = options.intervalMs ?? 100;
  const maxChars = options.maxChars ?? 64;
  const schedule = options.schedule ?? ((delayMs, callback) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? clearTimeout;

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("intervalMs must be greater than zero");
  }
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("maxChars must be a positive integer");
  }

  let buffer = "";
  let timer: TimerHandle | undefined;
  let writes = Promise.resolve();
  let closed = false;

  function clearTimer() {
    if (timer === undefined) return;
    cancel(timer);
    timer = undefined;
  }

  function enqueue(text: string) {
    if (text.length === 0) return;
    writes = writes.then(() => options.write(text));
  }

  function sizeBoundary(text: string) {
    let characters = 0;
    let index = 0;
    for (const character of text) {
      characters += 1;
      index += character.length;
      if (characters === maxChars) return index;
    }
    return undefined;
  }

  function takeReadyChunks() {
    while (buffer.length > 0) {
      const match = naturalBoundaryPattern.exec(buffer);
      const punctuationBoundary = match ? match.index + match[0].length : undefined;
      const lengthBoundary = sizeBoundary(buffer);
      const boundary =
        punctuationBoundary !== undefined &&
        (lengthBoundary === undefined || punctuationBoundary <= lengthBoundary)
          ? punctuationBoundary
          : lengthBoundary;

      if (boundary === undefined) return;
      const text = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary);
      enqueue(text);
    }
  }

  function flushBuffer() {
    if (buffer.length === 0) return;
    const text = buffer;
    buffer = "";
    enqueue(text);
  }

  function ensureTimer() {
    if (closed || buffer.length === 0 || timer !== undefined) return;
    timer = schedule(intervalMs, () => {
      timer = undefined;
      if (closed) return;
      flushBuffer();
      void writes.catch(() => undefined);
    });
  }

  return {
    async append(text) {
      if (closed) throw new Error("Event coalescer is closed");
      if (text.length === 0) {
        await writes;
        return;
      }

      clearTimer();
      buffer += text;
      takeReadyChunks();
      ensureTimer();
      await writes;
    },

    async flush() {
      if (!closed) {
        clearTimer();
        flushBuffer();
      }
      await writes;
    },

    async idle() {
      await writes;
    },

    async discard() {
      if (!closed) {
        closed = true;
        clearTimer();
        buffer = "";
      }
      await writes;
    },

    async dispose() {
      if (!closed) {
        closed = true;
        clearTimer();
        flushBuffer();
      }
      await writes;
    },
  };
}
