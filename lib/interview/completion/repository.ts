import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { interviewCompletionJobs } from "@/lib/db/schema";

export type CompletionJobStatus = "pending" | "running" | "completed" | "failed";

export type CompletionJobRecord = {
  id: string;
  interviewId: string;
  status: CompletionJobStatus;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
};

export interface CompletionJobRepository {
  createJob(interviewId: string): Promise<CompletionJobRecord>;
  getJob(jobId: string): Promise<CompletionJobRecord | null>;
  getJobByInterview(interviewId: string): Promise<CompletionJobRecord | null>;
  claimJob(jobId: string, owner: string, now: Date, leaseMs: number): Promise<CompletionJobRecord | null>;
  renewLease(jobId: string, owner: string, now: Date, leaseMs: number): Promise<boolean>;
  releaseLease(jobId: string, owner: string): Promise<void>;
  completeJob(jobId: string): Promise<void>;
  failJob(jobId: string, error: unknown): Promise<void>;
}

type Database = typeof import("@/lib/db").db;

export function createDrizzleCompletionJobRepository(database: Database): CompletionJobRepository {
  const selection = {
    id: interviewCompletionJobs.id,
    interviewId: interviewCompletionJobs.interviewId,
    status: interviewCompletionJobs.status,
    leaseOwner: interviewCompletionJobs.leaseOwner,
    leaseExpiresAt: interviewCompletionJobs.leaseExpiresAt,
    attemptCount: interviewCompletionJobs.attemptCount,
  };
  const normalize = (row: typeof interviewCompletionJobs.$inferSelect): CompletionJobRecord => ({
    id: row.id,
    interviewId: row.interviewId,
    status: row.status as CompletionJobStatus,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    attemptCount: row.attemptCount,
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
      const [row] = await database.update(interviewCompletionJobs).set({
        status: "running",
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        attemptCount: sql`${interviewCompletionJobs.attemptCount} + 1`,
        updatedAt: now,
      }).where(and(
        eq(interviewCompletionJobs.id, jobId),
        or(
          eq(interviewCompletionJobs.status, "pending"),
          eq(interviewCompletionJobs.status, "failed"),
          and(eq(interviewCompletionJobs.status, "running"), or(
            isNull(interviewCompletionJobs.leaseExpiresAt),
            lt(interviewCompletionJobs.leaseExpiresAt, now),
          )),
        ),
      )).returning();
      if (!row) return null;
      return normalize(row);
    },
    async renewLease(jobId, owner, now, leaseMs) {
      const rows = await database.update(interviewCompletionJobs).set({
        leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now,
      }).where(and(
        eq(interviewCompletionJobs.id, jobId),
        eq(interviewCompletionJobs.status, "running"),
        eq(interviewCompletionJobs.leaseOwner, owner),
      )).returning({ id: interviewCompletionJobs.id });
      return rows.length > 0;
    },
    async releaseLease(jobId, owner) {
      await database.update(interviewCompletionJobs).set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(interviewCompletionJobs.id, jobId), eq(interviewCompletionJobs.leaseOwner, owner)));
    },
    async completeJob(jobId) {
      await database.update(interviewCompletionJobs).set({
        status: "completed", completedAt: new Date(), errorJson: null, updatedAt: new Date(),
      }).where(eq(interviewCompletionJobs.id, jobId));
    },
    async failJob(jobId, error) {
      await database.update(interviewCompletionJobs).set({
        status: "failed", errorJson: serializeError(error), updatedAt: new Date(),
      }).where(eq(interviewCompletionJobs.id, jobId));
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
      const job = { id: crypto.randomUUID(), interviewId, status: "pending" as const, leaseOwner: null, leaseExpiresAt: null, attemptCount: 0 };
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
      if (!job || job.status === "completed" || (job.status === "running" && job.leaseExpiresAt && job.leaseExpiresAt > now)) return null;
      Object.assign(job, { status: "running", leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + leaseMs), attemptCount: job.attemptCount + 1 });
      return { ...job };
    },
    async renewLease(id, owner, now, leaseMs) {
      const job = jobs.get(id);
      if (!job || job.status !== "running" || job.leaseOwner !== owner) return false;
      job.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return true;
    },
    async releaseLease(id, owner) { const job = jobs.get(id); if (job?.leaseOwner === owner) Object.assign(job, { leaseOwner: null, leaseExpiresAt: null }); },
    async completeJob(id) { const job = jobs.get(id); if (job) job.status = "completed"; },
    async failJob(id) { const job = jobs.get(id); if (job) job.status = "failed"; },
  };
}
