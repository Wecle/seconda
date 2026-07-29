import { randomUUID } from "node:crypto";
import { startLeaseHeartbeat } from "@/lib/interview/agent/application/lease-heartbeat";
import type { InterviewAgentRepository } from "@/lib/interview/agent/persistence/repository";
import type {
  AgentRunExecutor,
  AgentRunScheduler,
} from "@/lib/interview/agent/application/ports";

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
  const lease = {
    owner: options.owner,
    generation: claimed.run.leaseGeneration,
  };
  if (!claimed.run.trigger) {
    await options.repository.terminateRun(options.runId, {
      exitReason: "aborted_tools",
      error: new Error("Agent run trigger is missing"),
    }, lease);
    return { status: "failed" as const };
  }

  const controller = new AbortController();
  let leaseLost = false;
  const heartbeat = startLeaseHeartbeat({
    intervalMs: options.renewEveryMs ?? 10_000,
    renew: () =>
      options.repository.renewLease(
        options.runId,
        lease,
        new Date(),
        leaseMs,
      ),
    onLeaseLost(error) {
      leaseLost = true;
      controller.abort(error);
    },
  });

  let executionFailed = false;
  let executionError: unknown;
  try {
    await options.executor.run({
      interviewId: claimed.run.interviewId,
      runId: claimed.run.id,
      mode: claimed.run.trigger.mode,
      instruction: claimed.run.trigger.instruction,
      signal: controller.signal,
      lease,
    });
  } catch (error) {
    executionFailed = true;
    executionError = error;
  }

  await heartbeat.stop();
  let status: "completed" | "lease_lost" | "failed";
  try {
    const current = await options.repository.getRun(options.runId);
    let persistedStatus = current?.status;
    if (executionFailed && !leaseLost && persistedStatus === "running") {
      const committed = (await options.repository.listEvents(options.runId, 0))
        .some((event) => event.type === "message_committed");
      await options.repository.terminateRun(options.runId, {
        exitReason: committed
          ? "completed"
          : isPromptTooLong(executionError)
            ? "prompt_too_long"
            : "aborted_streaming",
        ...(committed ? {} : { error: executionError }),
      }, lease);
      persistedStatus = committed ? "completed" : "failed";
    }

    status = persistedStatus === "completed"
      ? "completed"
      : persistedStatus === "failed"
        ? "failed"
        : leaseLost
          ? "lease_lost"
          : executionFailed ? "failed" : "completed";
  } finally {
    await options.repository.releaseLease(options.runId, lease);
  }
  return { status };
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
