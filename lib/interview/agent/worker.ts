import { randomUUID } from "node:crypto";
import type { InterviewAgentRepository } from "./repository";
import type { AgentRunRecord } from "./repository";
import type { AgentRunExecutor, AgentRunScheduler } from "./service";

export async function executeClaimedRun(options: {
  runId: string;
  owner: string;
  repository: InterviewAgentRepository;
  executor: AgentRunExecutor;
  leaseMs?: number;
  renewEveryMs?: number;
}) {
  const leaseMs = options.leaseMs ?? 30_000;
  const claimed = await options.repository.claimRun(
    options.runId,
    options.owner,
    new Date(),
    leaseMs,
  );
  if (!claimed.claimed || !claimed.run) return { status: "not_claimed" as const };
  if (!claimed.run.trigger) {
    await options.repository.terminateRun(options.runId, {
      exitReason: "aborted_tools",
      error: new Error("Agent run trigger is missing"),
    });
    return { status: "failed" as const };
  }

  const controller = new AbortController();
  let leaseLost = false;
  const interval = setInterval(async () => {
    try {
      const renewed = await options.repository.renewLease(
        options.runId,
        options.owner,
        new Date(),
        leaseMs,
      );
      if (!renewed) {
        leaseLost = true;
        controller.abort(new Error("Agent run lease was lost"));
      }
    } catch (error) {
      leaseLost = true;
      controller.abort(error);
    }
  }, options.renewEveryMs ?? 10_000);

  try {
    await options.executor.run({
      interviewId: claimed.run.interviewId,
      runId: claimed.run.id,
      mode: claimed.run.trigger.mode,
      instruction: claimed.run.trigger.instruction,
      signal: controller.signal,
    });
    return { status: leaseLost ? "lease_lost" as const : "completed" as const };
  } catch (error) {
    const current = await options.repository.getRun(options.runId);
    if (current?.status === "running") {
      await options.repository.terminateRun(options.runId, {
        exitReason: leaseLost
          ? "aborted_tools"
          : isPromptTooLong(error) ? "prompt_too_long" : "aborted_streaming",
        error,
      });
    }
    return { status: "failed" as const };
  } finally {
    clearInterval(interval);
    await options.repository.releaseLease(options.runId, options.owner);
  }
}

function isPromptTooLong(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "PROMPT_TOO_LONG";
}

export function createAgentRunScheduler(options: {
  repository: InterviewAgentRepository;
  executor: AgentRunExecutor;
  defer: (task: () => Promise<void>) => void;
}): AgentRunScheduler {
  return {
    async schedule(runId) {
      const owner = `worker:${randomUUID()}`;
      options.defer(async () => {
        await executeClaimedRun({
          runId,
          owner,
          repository: options.repository,
          executor: options.executor,
          leaseMs: readPositiveInteger(
            process.env.INTERVIEW_AGENT_LEASE_MS,
            30_000,
          ),
          renewEveryMs: readPositiveInteger(
            process.env.INTERVIEW_AGENT_LEASE_RENEW_MS,
            10_000,
          ),
        });
      });
    },
  };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRecoveryDisposition(
  run: AgentRunRecord,
  now: Date,
): "already_running" | "schedule" | "completed" | "failed" {
  if (run.status === "completed") return "completed";
  if (run.status === "failed") return "failed";
  if (
    run.leaseOwner &&
    run.leaseExpiresAt &&
    run.leaseExpiresAt.getTime() > now.getTime()
  ) {
    return "already_running";
  }
  return "schedule";
}
