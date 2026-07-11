import { randomUUID } from "node:crypto";
import type { InterviewAgentRepository } from "./repository";
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
    await options.repository.failRun(
      options.runId,
      "aborted_tools",
      new Error("Agent run trigger is missing"),
    );
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
      await options.repository.failRun(
        options.runId,
        leaseLost ? "aborted_tools" : "aborted_streaming",
        error,
      );
    }
    return { status: "failed" as const };
  } finally {
    clearInterval(interval);
    await options.repository.releaseLease(options.runId, options.owner);
  }
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
        });
      });
    },
  };
}
