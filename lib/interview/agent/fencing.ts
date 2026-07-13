import { and, eq } from "drizzle-orm";
import { interviewAgentRuns } from "@/lib/db/schema";
import type { RunLeaseToken } from "./repository";

export function agentRunFence(runId: string, lease: RunLeaseToken) {
  return and(
    eq(interviewAgentRuns.id, runId),
    eq(interviewAgentRuns.status, "running"),
    eq(interviewAgentRuns.leaseOwner, lease.owner),
    eq(interviewAgentRuns.leaseGeneration, lease.generation),
  );
}
