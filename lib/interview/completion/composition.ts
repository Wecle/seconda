import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { interviews } from "@/lib/db/schema";
import { completeInterviewReport } from "@/lib/interview/report-completion";
import { createDrizzleCompletionJobRepository } from "./repository";
import { scorePendingInterviewQuestions } from "./scoring";
import { createCompletionScheduler, type CompletionExecutor } from "./worker";

export function createProductionCompletionDependencies(defer: (task: () => Promise<void>) => void) {
  const repository = createDrizzleCompletionJobRepository(db);
  const executor: CompletionExecutor = {
    async run({ interviewId, signal }) {
      try {
        await db.update(interviews).set({ status: "scoring", updatedAt: new Date() }).where(and(
          eq(interviews.id, interviewId),
          inArray(interviews.status, ["active", "completing", "scoring", "failed"]),
        ));
        await scorePendingInterviewQuestions(db, interviewId, { concurrency: 3, signal });
        const transitioned = await db.update(interviews).set({ status: "reporting", updatedAt: new Date() }).where(and(
          eq(interviews.id, interviewId),
          inArray(interviews.status, ["scoring", "failed"]),
        )).returning({ id: interviews.id });
        if (transitioned.length === 0) {
          const [current] = await db.select({ status: interviews.status }).from(interviews)
            .where(eq(interviews.id, interviewId)).limit(1);
          if (current?.status === "completed") return;
          throw new Error("Interview could not transition to reporting");
        }
        await completeInterviewReport(db, interviewId);
      } catch (error) {
        await db.update(interviews).set({ status: "failed", updatedAt: new Date() })
          .where(and(eq(interviews.id, interviewId), inArray(interviews.status, ["scoring", "reporting"])));
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
