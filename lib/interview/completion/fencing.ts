import { and, eq, gt } from "drizzle-orm";
import { interviewCompletionJobs } from "@/lib/db/schema";
import type { CompletionLeaseToken } from "./repository";

type Database = typeof import("@/lib/db").db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class CompletionLeaseLostError extends Error {
  constructor() {
    super("Completion job lease is stale");
    this.name = "CompletionLeaseLostError";
  }
}

export async function assertCompletionLease(
  database: Database | Transaction,
  jobId: string,
  lease: CompletionLeaseToken,
) {
  const now = new Date();
  const rows = await database.update(interviewCompletionJobs).set({
    updatedAt: now,
  }).where(and(
    eq(interviewCompletionJobs.id, jobId),
    eq(interviewCompletionJobs.status, "running"),
    eq(interviewCompletionJobs.leaseOwner, lease.owner),
    eq(interviewCompletionJobs.leaseGeneration, lease.generation),
    gt(interviewCompletionJobs.leaseExpiresAt, now),
  )).returning({ id: interviewCompletionJobs.id });
  if (rows.length === 0) throw new CompletionLeaseLostError();
}
