export type CompletionPollState = {
  attempt: number;
  elapsedMs: number;
  status: string;
  visible: boolean;
  online: boolean;
};

const DELAYS = [1_500, 3_000, 5_000, 10_000] as const;

export function nextCompletionPoll(input: CompletionPollState): number | "paused" | null {
  if (["completed", "failed"].includes(input.status) || input.elapsedMs >= 120_000) return null;
  if (!input.visible || !input.online) return "paused";
  return DELAYS[Math.min(input.attempt, DELAYS.length - 1)];
}

export function shouldAutoResumeCompletion(input: {
  active: boolean;
  timedOut: boolean;
  alreadyAttempted: boolean;
  status: string;
}) {
  return input.active
    && input.timedOut
    && !input.alreadyAttempted
    && !["completed", "failed"].includes(input.status);
}
