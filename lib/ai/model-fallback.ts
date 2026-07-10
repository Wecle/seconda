export type ModelErrorAction =
  | "repair"
  | "transient"
  | "fallback"
  | "fatal";

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export async function runModelCandidates<T>(options: {
  models: readonly string[];
  signal: AbortSignal;
  classifyError: (error: unknown) => ModelErrorAction;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  attempt: (input: {
    model: string;
    repair: boolean;
    previousError?: unknown;
    signal: AbortSignal;
  }) => Promise<T>;
}): Promise<T> {
  const { models, signal, classifyError, sleep, attempt } = options;
  const random = options.random ?? Math.random;
  let repairUsed = false;
  let finalError: unknown = new Error("No model candidates were configured");

  for (const model of models) {
    let transientRetries = 0;
    let repair = false;
    let previousError: unknown;

    while (true) {
      throwIfAborted(signal);

      try {
        return await attempt({ model, repair, previousError, signal });
      } catch (error) {
        throwIfAborted(signal);
        finalError = error;
        const action = classifyError(error);

        if (action === "fatal") throw error;

        if (action === "repair" && !repairUsed) {
          repairUsed = true;
          repair = true;
          previousError = error;
          continue;
        }

        if (action === "transient" && transientRetries < 1) {
          transientRetries += 1;
          repair = false;
          previousError = undefined;
          await sleep(250 + Math.floor(random() * 250), signal);
          throwIfAborted(signal);
          continue;
        }

        break;
      }
    }
  }

  throw finalError;
}
