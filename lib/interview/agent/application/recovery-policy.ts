import {
  MAX_AGENT_RUN_RESUMES,
  type AgentRunRecord,
} from "@/lib/interview/agent/persistence/repository";

export type RecoveryDisposition =
  | "already_running"
  | "schedule"
  | "cooldown"
  | "exhausted"
  | "completed"
  | "failed";

export function getRecoveryDisposition(
  run: AgentRunRecord,
  now: Date,
): RecoveryDisposition {
  if (run.status === "completed") return "completed";
  if (run.status === "failed") {
    const recoverable = run.trigger
      && ["aborted_streaming", "provider_failed", "prompt_too_long"].includes(run.exitReason ?? "");
    if (!recoverable) return "failed";
    if (run.resumeCount >= MAX_AGENT_RUN_RESUMES) return "exhausted";
    if (run.nextResumeAt && run.nextResumeAt.getTime() > now.getTime()) return "cooldown";
    return "schedule";
  }
  if (
    run.leaseOwner &&
    run.leaseExpiresAt &&
    run.leaseExpiresAt.getTime() > now.getTime()
  ) {
    return "already_running";
  }
  if (run.resumeCount >= MAX_AGENT_RUN_RESUMES) return "exhausted";
  return "schedule";
}
