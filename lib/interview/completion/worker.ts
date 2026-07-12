import { randomUUID } from "node:crypto";
import type { CompletionJobRecord, CompletionJobRepository } from "./repository";

export interface CompletionExecutor {
  run(input: { interviewId: string; jobId: string; signal: AbortSignal }): Promise<void>;
}

export interface CompletionScheduler {
  schedule(jobId: string): Promise<void>;
}

export async function executeClaimedCompletionJob(options: {
  jobId: string;
  owner: string;
  repository: CompletionJobRepository;
  executor: CompletionExecutor;
  leaseMs?: number;
  renewEveryMs?: number;
}) {
  const leaseMs = options.leaseMs ?? 30_000;
  const job = await options.repository.claimJob(options.jobId, options.owner, new Date(), leaseMs);
  if (!job) return { status: "not_claimed" as const };
  const controller = new AbortController();
  let leaseLost = false;
  const interval = setInterval(async () => {
    try {
      if (!await options.repository.renewLease(job.id, options.owner, new Date(), leaseMs)) {
        leaseLost = true;
        controller.abort(new Error("Completion job lease was lost"));
      }
    } catch (error) {
      leaseLost = true;
      controller.abort(error);
    }
  }, options.renewEveryMs ?? 10_000);
  try {
    await options.executor.run({ interviewId: job.interviewId, jobId: job.id, signal: controller.signal });
    if (leaseLost) throw new Error("Completion job lease was lost");
    if (!await options.repository.completeJob(job.id, options.owner)) throw new Error("Completion lease was lost before commit");
    return { status: "completed" as const };
  } catch (error) {
    await options.repository.failJob(job.id, options.owner, error);
    return { status: "failed" as const };
  } finally {
    clearInterval(interval);
    await options.repository.releaseLease(job.id, options.owner);
  }
}

export function createCompletionScheduler(options: {
  repository: CompletionJobRepository;
  executor: CompletionExecutor;
  defer: (task: () => Promise<void>) => void;
}): CompletionScheduler {
  return {
    async schedule(jobId) {
      const owner = `completion:${randomUUID()}`;
      options.defer(() => executeClaimedCompletionJob({
        jobId, owner, repository: options.repository, executor: options.executor,
        leaseMs: readPositiveInteger(process.env.INTERVIEW_COMPLETION_LEASE_MS, 60_000),
        renewEveryMs: readPositiveInteger(process.env.INTERVIEW_COMPLETION_LEASE_RENEW_MS, 20_000),
      }).then(() => undefined));
    },
  };
}

export function getCompletionRecoveryDisposition(job: CompletionJobRecord, now: Date) {
  if (job.status === "completed") return "completed" as const;
  if (job.status === "running" && job.leaseExpiresAt && job.leaseExpiresAt > now) return "already_running" as const;
  return "schedule" as const;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
