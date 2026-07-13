import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { interviews } from "@/lib/db/schema";
import { completeInterviewReport } from "@/lib/interview/report-completion";
import { createDrizzleCompletionJobRepository } from "./repository";
import { scorePendingInterviewQuestions } from "./scoring";
import { createCompletionScheduler, type CompletionExecutor } from "./worker";
import { assertCompletionLease } from "./fencing";

export function createProductionCompletionDependencies(defer: (task: () => Promise<void>) => void) {
  const repository = createDrizzleCompletionJobRepository(db);
  const executor: CompletionExecutor = {
    async run({ interviewId, jobId, signal, lease }) {
      try {
        await assertCompletionLease(db, jobId, lease);
        const [initial] = await db.select({ status: interviews.status }).from(interviews)
          .where(eq(interviews.id, interviewId)).limit(1);
        if (!initial) throw new Error("Interview not found");
        if (initial.status === "completed") return;
        if (!["completing", "scoring", "reporting", "failed"].includes(initial.status)) {
          throw new Error("Interview is not in a resumable completion state");
        }
        if (initial.status !== "reporting") {
          const scoring = await db.transaction(async (tx) => {
            await assertCompletionLease(tx, jobId, lease);
            return tx.update(interviews).set({ status: "scoring", updatedAt: new Date() }).where(and(
              eq(interviews.id, interviewId),
              inArray(interviews.status, ["completing", "scoring", "failed"]),
            )).returning({ id: interviews.id });
          });
          if (scoring.length === 0) throw new Error("Interview could not transition to scoring");
          await scorePendingInterviewQuestions(db, interviewId, { concurrency: 3, signal, jobId, lease });
          const reporting = await db.transaction(async (tx) => {
            await assertCompletionLease(tx, jobId, lease);
            return tx.update(interviews).set({ status: "reporting", updatedAt: new Date() }).where(and(
              eq(interviews.id, interviewId),
              eq(interviews.status, "scoring"),
            )).returning({ id: interviews.id });
          });
          if (reporting.length === 0) throw new Error("Interview could not transition to reporting");
        }
        await completeInterviewReport(db, interviewId, { signal, jobId, lease });
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        try {
          await db.transaction(async (tx) => {
            await assertCompletionLease(tx, jobId, lease);
            await tx.update(interviews).set({ status: "failed", updatedAt: new Date() })
              .where(and(eq(interviews.id, interviewId), inArray(interviews.status, ["scoring", "reporting"])));
          });
        } catch {}
        throw error;
      }
    },
  };
  return { repository, executor, scheduler: createCompletionScheduler({ repository, executor, defer }) };
}

export async function scheduleInterviewCompletion(
  dependencies: ReturnType<typeof createProductionCompletionDependencies>,
  interviewId: string,
) {
  const job = await dependencies.repository.createJob(interviewId);
  if (job.status !== "completed") await dependencies.scheduler.schedule(job.id);
  return job;
}
