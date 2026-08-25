import { randomUUID } from "node:crypto";
import type { InterviewDatabase } from "../persistence/repository";

export const INTERVIEW_LEASE_RENEW_INTERVAL_MS = 10_000;
export const INTERVIEW_RUN_LEASE_MS = 30_000;

type RenewInterviewRunLease = (input: {
  database: InterviewDatabase;
  interviewRunId: string;
  agentRunId: string;
  attemptGeneration: number;
  leaseOwner: string;
  leaseDurationMs?: number;
}) => Promise<boolean>;

export function createInterviewLeaseOwner() {
  return randomUUID();
}

export function startInterviewRunLease(input: {
  database: InterviewDatabase;
  interviewRunId: string;
  agentRunId: string;
  attemptGeneration: number;
  leaseOwner: string;
  signal: AbortSignal;
  renewIntervalMs?: number;
  leaseDurationMs?: number;
  renew?: RenewInterviewRunLease;
}) {
  const lostLease = new AbortController();
  const combinedSignal = AbortSignal.any([input.signal, lostLease.signal]);
  let renewing = false;
  const interval = setInterval(async () => {
    if (renewing || combinedSignal.aborted) return;
    renewing = true;
    try {
      const renew = input.renew ?? (await import("../persistence/repository")).renewInterviewRunLease;
      const renewed = await renew({
        database: input.database,
        interviewRunId: input.interviewRunId,
        agentRunId: input.agentRunId,
        attemptGeneration: input.attemptGeneration,
        leaseOwner: input.leaseOwner,
        leaseDurationMs: input.leaseDurationMs ?? INTERVIEW_RUN_LEASE_MS,
      });
      if (!renewed) lostLease.abort(new Error("Interview run lease was lost"));
    } catch (error) {
      lostLease.abort(error);
    } finally {
      renewing = false;
    }
  }, input.renewIntervalMs ?? INTERVIEW_LEASE_RENEW_INTERVAL_MS);

  return {
    signal: combinedSignal,
    stop() {
      clearInterval(interval);
    },
  };
}
