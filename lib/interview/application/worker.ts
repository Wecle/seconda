import type { ExecuteCompletionDependencies } from "./execute-completion";
import type { executeInterviewOpening as defaultExecuteOpening } from "./execute-opening";
import type { executeInterviewTurn as defaultExecuteTurn } from "./execute-turn";
import type { executeInterviewCompletion as defaultExecuteCompletion } from "./execute-completion";
import type { claimNextAvailableCompletionJob as defaultClaimCompletion } from "../persistence/completion-repository";
import type { claimNextAvailableInterviewRun as defaultClaimRun, InterviewDatabase } from "../persistence/repository";

export interface WorkerCycleResult {
  processed: boolean;
  type?: "run" | "completion";
  id?: string;
  error?: unknown;
}

export interface WorkerDependencies {
  database?: InterviewDatabase;
  executeOpening?: typeof defaultExecuteOpening;
  executeTurn?: typeof defaultExecuteTurn;
  executeCompletion?: typeof defaultExecuteCompletion;
  claimNextRun?: typeof defaultClaimRun;
  claimNextCompletion?: typeof defaultClaimCompletion;
  completionDependencies?: ExecuteCompletionDependencies;
}

export async function runInterviewWorkerCycle(
  dependencies: WorkerDependencies = {},
): Promise<WorkerCycleResult> {
  try {
    const claimNextRun = dependencies.claimNextRun ?? (await import("../persistence/repository")).claimNextAvailableInterviewRun;
    const claimNextCompletion = dependencies.claimNextCompletion ?? (await import("../persistence/completion-repository")).claimNextAvailableCompletionJob;

    // 1. Check for available interview agent runs (opening or turn)
    const runClaim = dependencies.claimNextRun
      ? await claimNextRun({ database: dependencies.database ?? ({} as InterviewDatabase) })
      : await claimNextRun({ database: dependencies.database ?? (await import("@/lib/db")).db });

    if (runClaim.found && runClaim.run) {
      const { id, userId, triggerType } = runClaim.run;
      if (triggerType === "opening") {
        const executeOpening = dependencies.executeOpening ?? (await import("./execute-opening")).executeInterviewOpening;
        const database = dependencies.database ?? (await import("@/lib/db")).db;
        await executeOpening({ userId, openingRunId: id }, { database });
      } else {
        const executeTurn = dependencies.executeTurn ?? (await import("./execute-turn")).executeInterviewTurn;
        const database = dependencies.database ?? (await import("@/lib/db")).db;
        await executeTurn({ userId, interviewRunId: id }, { database });
      }
      return { processed: true, type: "run", id };
    }

    // 2. Check for available interview completion jobs
    const jobClaim = dependencies.claimNextCompletion
      ? await claimNextCompletion({ database: dependencies.database ?? ({} as InterviewDatabase) })
      : await claimNextCompletion({ database: dependencies.database ?? (await import("@/lib/db")).db });

    if (jobClaim.found && jobClaim.job) {
      const { id, userId, interviewId } = jobClaim.job;
      const executeCompletion = dependencies.executeCompletion ?? (await import("./execute-completion")).executeInterviewCompletion;
      const database = dependencies.database ?? (await import("@/lib/db")).db;
      await executeCompletion(
        { userId, interviewId },
        { database, ...dependencies.completionDependencies },
      );
      return { processed: true, type: "completion", id };
    }

    return { processed: false };
  } catch (error) {
    return { processed: false, error };
  }
}

export interface StartWorkerOptions {
  pollIntervalMs?: number;
  idlePollIntervalMs?: number;
  signal?: AbortSignal;
  dependencies?: WorkerDependencies;
  onError?: (error: unknown) => void;
}

export function startInterviewWorker(options: StartWorkerOptions = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const idlePollIntervalMs = options.idlePollIntervalMs ?? 2000;
  let running = true;
  let timeoutId: NodeJS.Timeout | null = null;

  const abortController = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, abortController.signal])
    : abortController.signal;

  const scheduleNext = (delay: number) => {
    if (!running || signal.aborted) return;
    timeoutId = setTimeout(async () => {
      if (!running || signal.aborted) return;
      try {
        const result = await runInterviewWorkerCycle(options.dependencies);
        if (result.error && options.onError) {
          options.onError(result.error);
        }
        if (running && !signal.aborted) {
          scheduleNext(result.processed ? pollIntervalMs : idlePollIntervalMs);
        }
      } catch (error) {
        if (options.onError) {
          options.onError(error);
        }
        if (running && !signal.aborted) {
          scheduleNext(idlePollIntervalMs);
        }
      }
    }, delay);
    if (timeoutId && typeof timeoutId.unref === "function") {
      timeoutId.unref();
    }
  };

  scheduleNext(0);

  return {
    get isRunning() {
      return running && !signal.aborted;
    },
    stop() {
      running = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      abortController.abort();
    },
  };
}
