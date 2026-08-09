export type FailedRunView = {
  status: "running" | "completed" | "failed";
  userMessage: string | null;
  recoveryDisposition?: "already_running" | "schedule" | "cooldown" | "exhausted" | "completed" | "failed";
};

export function runFailurePresentation(run: FailedRunView | null) {
  if (run?.status !== "failed" || !run.userMessage) return null;
  return {
    message: run.userMessage,
    action: run.recoveryDisposition === "schedule"
      ? "resume" as const
      : run.recoveryDisposition === "failed"
        ? "retry" as const
        : null,
  };
}
