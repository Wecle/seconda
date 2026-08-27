import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRateLimiter } from "./application/rate-limit";
import { runInterviewWorkerCycle, startInterviewWorker } from "./application/worker";
import type { InterviewDatabase } from "./persistence/repository";

test("SlidingWindowRateLimiter enforces limit, calculates retryAfter, and slides window", () => {
  let currentTime = 1000;
  const limiter = new SlidingWindowRateLimiter(
    {
      windowMs: 5000,
      maxRequests: 3,
    },
    () => currentTime,
  );

  // 1st request -> allowed (remaining: 2)
  const r1 = limiter.check("user-1");
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);

  // 2nd request -> allowed (remaining: 1)
  const r2 = limiter.check("user-1");
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);

  // 3rd request -> allowed (remaining: 0)
  const r3 = limiter.check("user-1");
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);

  // 4th request at same timestamp -> rejected
  const r4 = limiter.check("user-1");
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
  assert.equal(r4.retryAfterSeconds, 5);

  // Different user is not affected
  const otherUser = limiter.check("user-2");
  assert.equal(otherUser.allowed, true);
  assert.equal(otherUser.remaining, 2);

  // Advance time past the 1st request window (e.g. 1000 + 5001 = 6001)
  currentTime = 6001;
  const r5 = limiter.check("user-1");
  assert.equal(r5.allowed, true);

  // Test reset
  limiter.reset("user-1");
  const r6 = limiter.check("user-1");
  assert.equal(r6.allowed, true);
  assert.equal(r6.remaining, 2);
});

test("runInterviewWorkerCycle processes available opening run", async () => {
  let executedOpeningRunId: string | null = null;
  const fakeDatabase = {} as InterviewDatabase;

  const result = await runInterviewWorkerCycle({
    database: fakeDatabase,
    claimNextRun: async () => ({
      found: true,
      run: {
        id: "run-opening-1",
        interviewId: "int-1",
        userId: "user-1",
        triggerType: "opening" as const,
      },
    }),
    claimNextCompletion: async () => ({ found: false }),
    executeOpening: async (input) => {
      executedOpeningRunId = input.openingRunId;
      return {
        status: "active",
        question: {
          id: "q-1",
          interviewId: "int-1",
          sequence: 1,
          kind: "main",
          topic: "Architecture",
          question: "Tell me about yourself",
          tip: null,
          resumeEvidenceIds: [],
        },
      };
    },
  });

  assert.equal(result.processed, true);
  assert.equal(result.type, "run");
  assert.equal(result.id, "run-opening-1");
  assert.equal(executedOpeningRunId, "run-opening-1");
});

test("runInterviewWorkerCycle processes available turn run", async () => {
  let executedTurnRunId: string | null = null;
  const fakeDatabase = {} as InterviewDatabase;

  const result = await runInterviewWorkerCycle({
    database: fakeDatabase,
    claimNextRun: async () => ({
      found: true,
      run: {
        id: "run-turn-1",
        interviewId: "int-1",
        userId: "user-1",
        triggerType: "answer" as const,
      },
    }),
    claimNextCompletion: async () => ({ found: false }),
    executeTurn: async (input) => {
      executedTurnRunId = input.interviewRunId;
      return {
        runId: input.interviewRunId,
        runStatus: "completed",
        interviewStatus: "active",
        leaseExpiresAt: null,
      };
    },
  });

  assert.equal(result.processed, true);
  assert.equal(result.type, "run");
  assert.equal(result.id, "run-turn-1");
  assert.equal(executedTurnRunId, "run-turn-1");
});

test("runInterviewWorkerCycle processes completion job when no runs are queued", async () => {
  let executedCompletionInterviewId: string | null = null;
  const fakeDatabase = {} as InterviewDatabase;

  const result = await runInterviewWorkerCycle({
    database: fakeDatabase,
    claimNextRun: async () => ({ found: false }),
    claimNextCompletion: async () => ({
      found: true,
      job: {
        id: "job-1",
        interviewId: "int-100",
        userId: "user-1",
      },
    }),
    executeCompletion: async (input) => {
      executedCompletionInterviewId = input.interviewId;
      return {
        status: "completed" as const,
        report: {
          id: "rep-1",
          interviewId: input.interviewId,
          overallScore: 85,
          dimensionAveragesJson: null,
          summaryJson: {
            overallSummary: "Summary",
            keyStrengths: [],
            keyImprovements: [],
            recommendations: "Advice",
          },
          scoreStatus: "scored",
          generatedAt: new Date(),
        },
      };
    },
  });

  assert.equal(result.processed, true);
  assert.equal(result.type, "completion");
  assert.equal(result.id, "job-1");
  assert.equal(executedCompletionInterviewId, "int-100");
});

test("runInterviewWorkerCycle returns processed false when neither run nor job is found", async () => {
  const fakeDatabase = {} as InterviewDatabase;

  const result = await runInterviewWorkerCycle({
    database: fakeDatabase,
    claimNextRun: async () => ({ found: false }),
    claimNextCompletion: async () => ({ found: false }),
  });
  assert.equal(result.processed, false);
});

test("runInterviewWorkerCycle safely catches execution error", async () => {
  const fakeDatabase = {} as InterviewDatabase;

  const result = await runInterviewWorkerCycle({
    database: fakeDatabase,
    claimNextRun: async () => ({
      found: true,
      run: {
        id: "run-fail-1",
        interviewId: "int-1",
        userId: "user-1",
        triggerType: "opening" as const,
      },
    }),
    claimNextCompletion: async () => ({ found: false }),
    executeOpening: async () => {
      throw new Error("Simulated LLM Provider Down");
    },
  });

  assert.equal(result.processed, false);
  assert.ok(result.error instanceof Error);
  assert.equal((result.error as Error).message, "Simulated LLM Provider Down");
});

test("startInterviewWorker runs, stops, and handles errors cleanly", async () => {
  let cyclesRun = 0;
  const fakeDatabase = {} as InterviewDatabase;

  const worker = startInterviewWorker({
    pollIntervalMs: 5,
    idlePollIntervalMs: 5,
    dependencies: {
      database: fakeDatabase,
      claimNextRun: async () => {
        cyclesRun++;
        return { found: false };
      },
      claimNextCompletion: async () => ({ found: false }),
    },
  });

  assert.equal(worker.isRunning, true);

  // Wait for worker to run a few cycles
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(cyclesRun >= 1);

  worker.stop();
  assert.equal(worker.isRunning, false);

  const cyclesAfterStop = cyclesRun;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cyclesRun, cyclesAfterStop);
});
