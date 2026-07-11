import { randomUUID } from "node:crypto";

type AttemptCandidate = { model: string };
type ErrorClass = "transient" | "fatal";

export async function runAgentAttempts<T>(options: {
  candidates: readonly AttemptCandidate[];
  classifyError: (error: unknown) => ErrorClass;
  attempt: (input: {
    model: string;
    attemptId: string;
    attemptNumber: number;
    signal?: AbortSignal;
    acceptProvisional: () => void;
  }) => Promise<T>;
  onAttemptStarted: (input: {
    model: string;
    attemptId: string;
    attemptNumber: number;
  }) => Promise<void>;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  createId?: (model: string, attemptNumber: number) => string;
  signal?: AbortSignal;
}): Promise<{ value: T; model: string; attemptId: string; attemptNumber: number }> {
  const random = options.random ?? Math.random;
  const createId = options.createId ?? (() => randomUUID());
  const sleep = options.sleep ?? defaultSleep;
  let attemptNumber = 0;
  let finalError: unknown = new Error("No Agent model candidates configured");

  for (const candidate of options.candidates) {
    for (let retry = 0; retry <= 2; retry += 1) {
      throwIfAborted(options.signal);
      attemptNumber += 1;
      const attemptId = createId(candidate.model, attemptNumber);
      let provisionalAccepted = false;
      await options.onAttemptStarted({
        model: candidate.model,
        attemptId,
        attemptNumber,
      });
      try {
        const value = await options.attempt({
          model: candidate.model,
          attemptId,
          attemptNumber,
          signal: options.signal,
          acceptProvisional: () => {
            provisionalAccepted = true;
          },
        });
        return { value, model: candidate.model, attemptId, attemptNumber };
      } catch (error) {
        finalError = error;
        throwIfAborted(options.signal);
        if (provisionalAccepted) {
          throw Object.assign(
            new Error("Provider stream failed after provisional content was accepted", { cause: error }),
            { code: "PROVISIONAL_STREAM_ABORTED", attemptId },
          );
        }
        if (options.classifyError(error) === "fatal") throw error;
        if (retry < 2) {
          const maximum = Math.min(8_000, 500 * 2 ** retry);
          await sleep(Math.floor(random() * maximum), options.signal);
        }
      }
    }
  }
  throw finalError;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
  }
}

function defaultSleep(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}
