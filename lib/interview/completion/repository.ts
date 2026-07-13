import { and, eq, gt, isNull, lte, lt, or, sql } from "drizzle-orm";
import { interviewCompletionJobs } from "@/lib/db/schema";

export const MAX_COMPLETION_ATTEMPTS = 3;

export type CompletionJobStatus = "pending" | "running" | "completed" | "failed" | "exhausted";

export type CompletionLeaseToken = { owner: string; generation: number };

export type CompletionJobRecord = {
  id: string;
  interviewId: string;
  status: CompletionJobStatus;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseGeneration: number;
  attemptCount: number;
  nextAttemptAt: Date | null;
};

export interface CompletionJobRepository {
  createJob(interviewId: string): Promise<CompletionJobRecord>;
  getJob(jobId: string): Promise<CompletionJobRecord | null>;
  getJobByInterview(interviewId: string): Promise<CompletionJobRecord | null>;
  claimJob(jobId: string, owner: string, now: Date, leaseMs: number): Promise<CompletionJobRecord | null>;
  renewLease(jobId: string, lease: CompletionLeaseToken, now: Date, leaseMs: number): Promise<boolean>;
  releaseLease(jobId: string, lease: CompletionLeaseToken): Promise<void>;
  completeJob(jobId: string, lease: CompletionLeaseToken): Promise<boolean>;
  failJob(jobId: string, lease: CompletionLeaseToken, error: unknown, now: Date): Promise<boolean>;
}

type Database = typeof import("@/lib/db").db;

export function createDrizzleCompletionJobRepository(database: Database): CompletionJobRepository {
  const selection = {
    id: interviewCompletionJobs.id,
    interviewId: interviewCompletionJobs.interviewId,
    status: interviewCompletionJobs.status,
    leaseOwner: interviewCompletionJobs.leaseOwner,
    leaseExpiresAt: interviewCompletionJobs.leaseExpiresAt,
    leaseGeneration: interviewCompletionJobs.leaseGeneration,
    attemptCount: interviewCompletionJobs.attemptCount,
    nextAttemptAt: interviewCompletionJobs.nextAttemptAt,
  };
  const normalize = (row: typeof interviewCompletionJobs.$inferSelect): CompletionJobRecord => ({
    id: row.id,
    interviewId: row.interviewId,
    status: row.status as CompletionJobStatus,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    leaseGeneration: row.leaseGeneration,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
  });
  return {
    async createJob(interviewId) {
      const inserted = await database.insert(interviewCompletionJobs).values({ interviewId })
        .onConflictDoNothing({ target: interviewCompletionJobs.interviewId }).returning();
      if (inserted[0]) return normalize(inserted[0]);
      const existing = await this.getJobByInterview(interviewId);
      if (!existing) throw new Error("Completion job could not be created");
      return existing;
    },
    async getJob(jobId) {
      const [row] = await database.select(selection).from(interviewCompletionJobs)
        .where(eq(interviewCompletionJobs.id, jobId)).limit(1);
      return row ? { ...row, status: row.status as CompletionJobStatus } : null;
    },
    async getJobByInterview(interviewId) {
      const [row] = await database.select(selection).from(interviewCompletionJobs)
        .where(eq(interviewCompletionJobs.interviewId, interviewId)).limit(1);
      return row ? { ...row, status: row.status as CompletionJobStatus } : null;
    },
    async claimJob(jobId, owner, now, leaseMs) {
      await database.update(interviewCompletionJobs).set({
        status: "exhausted",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        updatedAt: now,
      }).where(and(
        eq(interviewCompletionJobs.id, jobId),
        eq(interviewCompletionJobs.status, "running"),
        sql`${interviewCompletionJobs.attemptCount} >= ${MAX_COMPLETION_ATTEMPTS}`,
        or(
          isNull(interviewCompletionJobs.leaseExpiresAt),
          lte(interviewCompletionJobs.leaseExpiresAt, now),
        ),
      ));
      const [row] = await database.update(interviewCompletionJobs).set({
        status: "running",
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        leaseGeneration: sql`${interviewCompletionJobs.leaseGeneration} + 1`,
        attemptCount: sql`${interviewCompletionJobs.attemptCount} + 1`,
        nextAttemptAt: null,
        updatedAt: now,
      }).where(and(
        eq(interviewCompletionJobs.id, jobId),
        or(
          and(
            eq(interviewCompletionJobs.status, "pending"),
            lt(interviewCompletionJobs.attemptCount, MAX_COMPLETION_ATTEMPTS),
          ),
          and(
            eq(interviewCompletionJobs.status, "failed"),
            lt(interviewCompletionJobs.attemptCount, MAX_COMPLETION_ATTEMPTS),
            or(
              isNull(interviewCompletionJobs.nextAttemptAt),
              lte(interviewCompletionJobs.nextAttemptAt, now),
            ),
          ),
          and(
            eq(interviewCompletionJobs.status, "running"),
            lt(interviewCompletionJobs.attemptCount, MAX_COMPLETION_ATTEMPTS),
            or(
              isNull(interviewCompletionJobs.leaseExpiresAt),
              lt(interviewCompletionJobs.leaseExpiresAt, now),
            ),
          ),
        ),
      )).returning();
      if (!row) return null;
      return normalize(row);
    },
    async renewLease(jobId, lease, now, leaseMs) {
      const rows = await database.update(interviewCompletionJobs).set({
        leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now,
      }).where(and(
        eq(interviewCompletionJobs.id, jobId),
        eq(interviewCompletionJobs.status, "running"),
        eq(interviewCompletionJobs.leaseOwner, lease.owner),
        eq(interviewCompletionJobs.leaseGeneration, lease.generation),
        gt(interviewCompletionJobs.leaseExpiresAt, now),
      )).returning({ id: interviewCompletionJobs.id });
      return rows.length > 0;
    },
    async releaseLease(jobId, lease) {
      await database.update(interviewCompletionJobs).set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
        .where(and(
          eq(interviewCompletionJobs.id, jobId),
          eq(interviewCompletionJobs.leaseOwner, lease.owner),
          eq(interviewCompletionJobs.leaseGeneration, lease.generation),
        ));
    },
    async completeJob(jobId, lease) {
      const now = new Date();
      const rows = await database.update(interviewCompletionJobs).set({
        status: "completed", completedAt: now, errorJson: null, updatedAt: now,
      }).where(and(eq(interviewCompletionJobs.id, jobId), eq(interviewCompletionJobs.leaseOwner, lease.owner), eq(interviewCompletionJobs.leaseGeneration, lease.generation), eq(interviewCompletionJobs.status, "running"), gt(interviewCompletionJobs.leaseExpiresAt, now)))
        .returning({ id: interviewCompletionJobs.id });
      return rows.length > 0;
    },
    async failJob(jobId, lease, error, now) {
      const rows = await database.update(interviewCompletionJobs).set({
        status: sql`CASE WHEN ${interviewCompletionJobs.attemptCount} >= ${MAX_COMPLETION_ATTEMPTS} THEN 'exhausted' ELSE 'failed' END`,
        nextAttemptAt: sql`CASE WHEN ${interviewCompletionJobs.attemptCount} >= ${MAX_COMPLETION_ATTEMPTS} THEN NULL ELSE ${now} + LEAST(300000, 30000 * POWER(2, GREATEST(${interviewCompletionJobs.attemptCount} - 1, 0))) * INTERVAL '1 millisecond' END`,
        errorJson: serializeError(error), updatedAt: now,
      }).where(and(eq(interviewCompletionJobs.id, jobId), eq(interviewCompletionJobs.leaseOwner, lease.owner), eq(interviewCompletionJobs.leaseGeneration, lease.generation), eq(interviewCompletionJobs.status, "running"), gt(interviewCompletionJobs.leaseExpiresAt, now)))
        .returning({ id: interviewCompletionJobs.id });
      return rows.length > 0;
    },
  };
}

function serializeError(error: unknown) {
  return { message: error instanceof Error ? error.message.slice(0, 500) : "Completion job failed" };
}

export function createInMemoryCompletionJobRepository(): CompletionJobRepository {
  const jobs = new Map<string, CompletionJobRecord>();
  return {
    async createJob(interviewId) {
      const existing = [...jobs.values()].find((job) => job.interviewId === interviewId);
      if (existing) return { ...existing };
      const job = { id: crypto.randomUUID(), interviewId, status: "pending" as const, leaseOwner: null, leaseExpiresAt: null, leaseGeneration: 0, attemptCount: 0, nextAttemptAt: null };
      jobs.set(job.id, job);
      return { ...job };
    },
    async getJob(id) { return jobs.has(id) ? { ...jobs.get(id)! } : null; },
    async getJobByInterview(interviewId) {
      const job = [...jobs.values()].find((item) => item.interviewId === interviewId);
      return job ? { ...job } : null;
    },
    async claimJob(id, owner, now, leaseMs) {
      const job = jobs.get(id);
      if (job?.status === "running" && job.attemptCount >= MAX_COMPLETION_ATTEMPTS && (!job.leaseExpiresAt || job.leaseExpiresAt <= now)) {
        Object.assign(job, { status: "exhausted", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null });
      }
      if (!job || job.status === "completed" || job.status === "exhausted" || job.attemptCount >= MAX_COMPLETION_ATTEMPTS || (job.status === "failed" && job.nextAttemptAt && job.nextAttemptAt > now) || (job.status === "running" && job.leaseExpiresAt && job.leaseExpiresAt > now)) return null;
      Object.assign(job, { status: "running", leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + leaseMs), leaseGeneration: job.leaseGeneration + 1, attemptCount: job.attemptCount + 1, nextAttemptAt: null });
      return { ...job };
    },
    async renewLease(id, lease, now, leaseMs) {
      const job = jobs.get(id);
      if (!job || job.status !== "running" || job.leaseOwner !== lease.owner || job.leaseGeneration !== lease.generation || !job.leaseExpiresAt || job.leaseExpiresAt <= now) return false;
      job.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return true;
    },
    async releaseLease(id, lease) { const job = jobs.get(id); if (job?.leaseOwner === lease.owner && job.leaseGeneration === lease.generation) Object.assign(job, { leaseOwner: null, leaseExpiresAt: null }); },
    async completeJob(id, lease) { const job = jobs.get(id); const now = new Date(); if (!job || job.leaseOwner !== lease.owner || job.leaseGeneration !== lease.generation || job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt <= now) return false; job.status = "completed"; return true; },
    async failJob(id, lease, _error, now) { const job = jobs.get(id); if (!job || job.leaseOwner !== lease.owner || job.leaseGeneration !== lease.generation || job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt <= now) return false; job.status = job.attemptCount >= MAX_COMPLETION_ATTEMPTS ? "exhausted" : "failed"; job.nextAttemptAt = job.status === "failed" ? new Date(now.getTime() + Math.min(300_000, 30_000 * (2 ** Math.max(0, job.attemptCount - 1)))) : null; return true; },
  };
}
