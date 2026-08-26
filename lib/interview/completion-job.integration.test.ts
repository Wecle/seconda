import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  agentEvents,
  agentSessions,
  interviewAnswers,
  interviewCompletionJobs,
  interviewQuestions,
  interviewReports,
  interviewResumeSnapshots,
  interviews,
  questionScores,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
import type { QuestionEvaluation, ReportSummary } from "./domain/scoring";

const databaseUrl = process.env.DATABASE_URL;

async function createInterviewFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const userId = randomUUID();
  await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
  const [resume] = await database.insert(resumes).values({ userId, title: "Test Resume" }).returning();
  const [version] = await database.insert(resumeVersions).values({
    resumeId: resume.id,
    versionNumber: 1,
    sourceType: "generated",
    parsedJson: { name: "Test Candidate" },
    extractedText: "Test Candidate Resume Content",
  }).returning();

  const [session] = await database.insert(agentSessions).values({
    userId,
    title: "Interview Session",
    model: "claude-3-5-haiku-latest",
    capability: "interview",
    promptVersion: "interview-agent-v1",
    systemPrompt: "System prompt",
    status: "running",
  }).returning();

  const [interview] = await database.insert(interviews).values({
    userId,
    creationIdempotencyKey: randomUUID(),
    creationRequestHash: "fixture-hash",
    resumeVersionId: version.id,
    agentSessionId: session.id,
    language: "zh",
    persona: "standard",
    interviewType: "technical",
    targetLevel: "Senior",
    targetRole: "Fullstack Engineer",
    targetRoundCount: 3,
    status: "completing",
  }).returning();

  await database.insert(interviewResumeSnapshots).values({
    interviewId: interview.id,
    resumeId: resume.id,
    resumeVersionId: version.id,
    resumeTitle: resume.title,
    versionNumber: version.versionNumber,
    sourceType: version.sourceType,
    parsedJson: version.parsedJson!,
    canonicalText: "Test Candidate Resume Content",
    evidenceJson: {},
    contentHash: "hash",
  });

  return { userId, resume, version, session, interview };
}

test("completion claim enforces ownership, completing status, and session capability", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { claimCompletionJob, ensureCompletionJobInTransaction } = await import("./persistence/completion-repository");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.transaction(async (tx) => {
      await ensureCompletionJobInTransaction(tx, fixture.interview.id);
    });

    // 1. Non-owner cannot claim
    const wrongUserResult = await claimCompletionJob({
      database,
      userId: randomUUID(),
      interviewId: fixture.interview.id,
    });
    assert.equal(wrongUserResult.state, "not_found");

    // 2. Active status interview cannot be claimed
    await database.update(interviews).set({ status: "active" }).where(eq(interviews.id, fixture.interview.id));
    const activeResult = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(activeResult.state, "invalid_state");

    // Restore to completing
    await database.update(interviews).set({ status: "completing" }).where(eq(interviews.id, fixture.interview.id));

    // 3. Session with non-interview capability rejected
    const [workspaceSession] = await database.insert(agentSessions).values({
      userId: fixture.userId,
      title: "Workspace Session",
      model: "claude-3-5-haiku-latest",
      capability: "workspace",
      promptVersion: "workspace-agent-v1",
      systemPrompt: "System",
      workspaceRoot: "/tmp",
    }).returning();

    await database.update(interviews).set({ agentSessionId: workspaceSession.id }).where(eq(interviews.id, fixture.interview.id));
    const workspaceResult = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(workspaceResult.state, "invalid_state");

    // Restore session
    await database.update(interviews).set({ agentSessionId: fixture.session.id }).where(eq(interviews.id, fixture.interview.id));

    // 4. Valid owner claim succeeds
    const validClaim = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(validClaim.state, "claimed");
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("question score claim protocol enforces single claim, takeover on expiry, and fences stale workers", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const {
    claimCompletionJob,
    claimNextQuestionScore,
    commitClaimedQuestionScore,
    ensureCompletionJobInTransaction,
    ensurePendingQuestionScoresInTransaction,
    failClaimedQuestionScore,
  } = await import("./persistence/completion-repository");

  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.insert(schema.agentRuns).values({
      sessionId: fixture.session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [run1] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-1",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run1.id,
      sequence: 1,
      kind: "main",
      topic: "State Management",
      question: "Explain Redux",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: fixture.interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "Redux uses immutable state and pure reducers.",
      status: "answered",
    });

    await database.transaction(async (tx) => {
      await ensureCompletionJobInTransaction(tx, fixture.interview.id);
      await ensurePendingQuestionScoresInTransaction(tx, fixture.interview.id);
    });

    const jobClaim = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(jobClaim.state, "claimed");
    if (jobClaim.state !== "claimed") return;

    // 1. Worker 1 claims question score
    const claim1 = await claimNextQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      jobClaimToken: jobClaim.claimToken,
      leaseDurationMs: 50, // Short lease
    });

    assert.equal(claim1.state, "claimed");
    if (claim1.state !== "claimed") return;
    assert.equal(claim1.questionId, q1.id);

    // Concurrent claim sees none pending (already claimed)
    const concurrentClaim = await claimNextQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      jobClaimToken: jobClaim.claimToken,
    });
    assert.equal(concurrentClaim.state, "none_pending");

    // Wait for lease to expire
    await new Promise((r) => setTimeout(r, 60));

    // Worker 2 takes over expired score
    const claim2 = await claimNextQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      jobClaimToken: jobClaim.claimToken,
      leaseDurationMs: 60_000,
    });
    assert.equal(claim2.state, "claimed");
    if (claim2.state !== "claimed") return;

    const evaluation: QuestionEvaluation = {
      scores: { understanding: 9, expression: 8, logic: 9, depth: 8, authenticity: 8, reflection: 8 },
      strengths: ["Great explanation"],
      improvements: ["Could mention middleware"],
      advice: "Include RTK examples.",
    };

    // Stale Worker 1 attempts commit with old token -> REJECTED
    await assert.rejects(
      commitClaimedQuestionScore({
        database,
        interviewId: fixture.interview.id,
        jobId: jobClaim.job.id,
        jobClaimToken: jobClaim.claimToken,
        scoreId: claim1.scoreId,
        questionId: q1.id,
        scoreClaimToken: claim1.scoreClaimToken,
        evaluation,
        overall: 8.3,
      }),
      /Score claim is invalid or expired/,
    );

    // Stale Worker 1 attempts fail with old token -> REJECTED (returns false)
    const staleFail = await failClaimedQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      jobClaimToken: jobClaim.claimToken,
      scoreId: claim1.scoreId,
      questionId: q1.id,
      scoreClaimToken: claim1.scoreClaimToken,
      error: new Error("Stale error"),
    });
    assert.equal(staleFail, false);

    // Valid Worker 2 commits score -> SUCCEEDS
    const committed = await commitClaimedQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      jobClaimToken: jobClaim.claimToken,
      scoreId: claim2.scoreId,
      questionId: q1.id,
      scoreClaimToken: claim2.scoreClaimToken,
      evaluation,
      overall: 8.3,
    });
    assert.equal(committed.status, "scored");
    assert.equal(committed.understanding, 9);
    assert.equal(committed.claimToken, null);
    assert.equal(committed.claimExpiresAt, null);

    // Next claim sees none pending (all scored)
    const afterScoredClaim = await claimNextQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      jobClaimToken: jobClaim.claimToken,
    });
    assert.equal(afterScoredClaim.state, "none_pending");
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("completion job retry restricts active jobs, resets failed scores only, and pushes SSE event", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const {
    claimCompletionJob,
    ensureCompletionJobInTransaction,
    failCompletionJob,
    retryCompletionJob,
  } = await import("./persistence/completion-repository");

  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.transaction(async (tx) => {
      await ensureCompletionJobInTransaction(tx, fixture.interview.id);
    });

    // 1. Claim active job
    const claim = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
      leaseDurationMs: 60_000,
    });
    assert.equal(claim.state, "claimed");
    if (claim.state !== "claimed") return;

    // 2. Active valid job retry returns unavailable
    const activeRetry = await retryCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(activeRetry.state, "unavailable");

    // 3. Mark job failed with sensitive error
    const errorWithSecret = new Error("Connection failed: sk-ant-secret-key-1234567890 candidate@test.com");
    const failed = await failCompletionJob({
      database,
      jobId: claim.job.id,
      claimToken: claim.claimToken,
      error: errorWithSecret,
    });
    assert.equal(failed, true);

    // Verify error is sanitized in database
    const [failedJob] = await database.select().from(interviewCompletionJobs).where(eq(interviewCompletionJobs.id, claim.job.id));
    assert.equal(failedJob.status, "failed");
    assert.deepEqual(failedJob.errorJson, {
      code: "INTERNAL_ERROR",
      category: "internal",
      retryable: true,
    });

    // Verify interview/completion_failed event was emitted to push SSE
    const events = await database.select().from(agentEvents).where(eq(agentEvents.sessionId, fixture.session.id));
    const failedEvent = events.find((e) => e.type === "interview/completion_failed");
    assert.ok(failedEvent);
    assert.equal(failedEvent.visibility, "internal");
    assert.equal((failedEvent.payload as { code: string }).code, "INTERNAL_ERROR");

    // 4. Retry failed job -> SUCCEEDS
    const retryResult = await retryCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(retryResult.state, "ready");

    // Verify interview/completion_retried event was appended to push SSE
    const eventsAfterRetry = await database.select().from(agentEvents).where(eq(agentEvents.sessionId, fixture.session.id));
    const retriedEvent = eventsAfterRetry.find((e) => e.type === "interview/completion_retried");
    assert.ok(retriedEvent);
    assert.equal(retriedEvent.visibility, "internal");
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("job takeover resets unexpired scoring score and fences old worker renewals and commits", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const {
    claimCompletionJob,
    claimNextQuestionScore,
    commitClaimedQuestionScore,
    ensureCompletionJobInTransaction,
    ensurePendingQuestionScoresInTransaction,
    failClaimedQuestionScore,
    renewQuestionScoreClaim,
  } = await import("./persistence/completion-repository");

  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.insert(schema.agentRuns).values({
      sessionId: fixture.session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [run1] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-1",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run1.id,
      sequence: 1,
      kind: "main",
      topic: "System Design",
      question: "Design a cache",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: fixture.interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "Use LRU eviction with a doubly linked list and hash map.",
      status: "answered",
    });

    await database.transaction(async (tx) => {
      await ensureCompletionJobInTransaction(tx, fixture.interview.id);
      await ensurePendingQuestionScoresInTransaction(tx, fixture.interview.id);
    });

    // 1. Worker A claims Job and Question Score
    const workerAJobClaim = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
      leaseDurationMs: 60_000,
    });
    assert.equal(workerAJobClaim.state, "claimed");
    if (workerAJobClaim.state !== "claimed") return;

    const workerAScoreClaim = await claimNextQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: workerAJobClaim.job.id,
      jobClaimToken: workerAJobClaim.claimToken,
      leaseDurationMs: 60_000,
    });
    assert.equal(workerAScoreClaim.state, "claimed");
    if (workerAScoreClaim.state !== "claimed") return;

    // 2. Simulate Job lease expiration while Score lease is still valid
    await database
      .update(interviewCompletionJobs)
      .set({ claimExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(interviewCompletionJobs.id, workerAJobClaim.job.id));

    // 3. Worker B takes over Job
    const workerBJobClaim = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
      leaseDurationMs: 60_000,
    });
    assert.equal(workerBJobClaim.state, "claimed");
    if (workerBJobClaim.state !== "claimed") return;

    // 4. Verify Worker A cannot renew Score (renewQuestionScoreClaim returns false)
    const workerARenew = await renewQuestionScoreClaim({
      database,
      interviewId: fixture.interview.id,
      jobId: workerAJobClaim.job.id,
      jobClaimToken: workerAJobClaim.claimToken,
      scoreId: workerAScoreClaim.scoreId,
      scoreClaimToken: workerAScoreClaim.scoreClaimToken,
    });
    assert.equal(workerARenew, false);

    // 5. Verify takeover transaction reset the old scoring Score to pending
    const [scoreRow] = await database
      .select()
      .from(questionScores)
      .where(eq(questionScores.id, workerAScoreClaim.scoreId));
    assert.equal(scoreRow.status, "pending");
    assert.equal(scoreRow.claimToken, null);
    assert.equal(scoreRow.claimExpiresAt, null);

    // 6. Worker B can immediately claim the Score without waiting for Worker A's old score lease
    const workerBScoreClaim = await claimNextQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: workerBJobClaim.job.id,
      jobClaimToken: workerBJobClaim.claimToken,
      leaseDurationMs: 60_000,
    });
    assert.equal(workerBScoreClaim.state, "claimed");
    if (workerBScoreClaim.state !== "claimed") return;
    assert.equal(workerBScoreClaim.questionId, q1.id);

    // 7. Worker A attempts commit or fail -> both REJECTED
    const evaluation: QuestionEvaluation = {
      scores: { understanding: 9, expression: 9, logic: 9, depth: 9, authenticity: 9, reflection: 9 },
      strengths: ["Great cache design"],
      improvements: ["Mention concurrency locks"],
      advice: "Add concurrent hash map discussion.",
    };

    await assert.rejects(
      commitClaimedQuestionScore({
        database,
        interviewId: fixture.interview.id,
        jobId: workerAJobClaim.job.id,
        jobClaimToken: workerAJobClaim.claimToken,
        scoreId: workerAScoreClaim.scoreId,
        questionId: q1.id,
        scoreClaimToken: workerAScoreClaim.scoreClaimToken,
        evaluation,
        overall: 9.0,
      }),
      /Completion job claim is invalid or expired/,
    );

    const workerAFail = await failClaimedQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: workerAJobClaim.job.id,
      jobClaimToken: workerAJobClaim.claimToken,
      scoreId: workerAScoreClaim.scoreId,
      questionId: q1.id,
      scoreClaimToken: workerAScoreClaim.scoreClaimToken,
      error: new Error("Worker A failed"),
    });
    assert.equal(workerAFail, false);

    // 8. Worker B commits score successfully
    const committed = await commitClaimedQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: workerBJobClaim.job.id,
      jobClaimToken: workerBJobClaim.claimToken,
      scoreId: workerBScoreClaim.scoreId,
      questionId: q1.id,
      scoreClaimToken: workerBScoreClaim.scoreClaimToken,
      evaluation,
      overall: 9.0,
    });
    assert.equal(committed.status, "scored");
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("retryCompletionJob resets scoring claims left by aborted workers and active jobs cannot be preempted", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const {
    claimCompletionJob,
    claimNextQuestionScore,
    ensureCompletionJobInTransaction,
    ensurePendingQuestionScoresInTransaction,
    retryCompletionJob,
  } = await import("./persistence/completion-repository");

  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.insert(schema.agentRuns).values({
      sessionId: fixture.session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [run1] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-1",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run1.id,
      sequence: 1,
      kind: "main",
      topic: "DB",
      question: "Explain indexes",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: fixture.interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "B-Tree indexes speed up lookups.",
      status: "answered",
    });

    await database.transaction(async (tx) => {
      await ensureCompletionJobInTransaction(tx, fixture.interview.id);
      await ensurePendingQuestionScoresInTransaction(tx, fixture.interview.id);
    });

    const jobClaim = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
      leaseDurationMs: 60_000,
    });
    assert.equal(jobClaim.state, "claimed");
    if (jobClaim.state !== "claimed") return;

    const scoreClaim = await claimNextQuestionScore({
      database,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      jobClaimToken: jobClaim.claimToken,
      leaseDurationMs: 60_000,
    });
    assert.equal(scoreClaim.state, "claimed");

    // Active valid job cannot be retried
    const activeRetry = await retryCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(activeRetry.state, "unavailable");

    // Job expires
    await database
      .update(interviewCompletionJobs)
      .set({ claimExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(interviewCompletionJobs.id, jobClaim.job.id));

    // Retry reset job and resets scoring question score to pending with null claims
    const expiredRetry = await retryCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(expiredRetry.state, "ready");

    const [refreshedScore] = await database
      .select()
      .from(questionScores)
      .where(eq(questionScores.id, scoreClaim.scoreId));
    assert.equal(refreshedScore.status, "pending");
    assert.equal(refreshedScore.claimToken, null);
    assert.equal(refreshedScore.claimExpiresAt, null);
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("commitCompletionReport validates all scorable questions are scored and computes aggregates deterministically", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const {
    claimCompletionJob,
    commitCompletionReport,
    ensureCompletionJobInTransaction,
    transitionJobToReporting,
  } = await import("./persistence/completion-repository");

  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.insert(schema.agentRuns).values({
      sessionId: fixture.session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [run1] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-1",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run1.id,
      sequence: 1,
      kind: "main",
      topic: "React",
      question: "Explain useEffect",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: fixture.interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "useEffect handles side effects in React components.",
      status: "answered",
    });

    await database.transaction(async (tx) => {
      await ensureCompletionJobInTransaction(tx, fixture.interview.id);
    });

    const jobClaim = await claimCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(jobClaim.state, "claimed");
    if (jobClaim.state !== "claimed") return;

    await transitionJobToReporting({
      database,
      jobId: jobClaim.job.id,
      claimToken: jobClaim.claimToken,
    });

    const summary: ReportSummary = {
      overallSummary: "Good grasp of React hooks.",
      keyStrengths: ["Clear explanation"],
      keyImprovements: ["Mention cleanup functions"],
      recommendations: "Practice concurrent features",
    };

    // Attempt to commit report BEFORE scoring question -> REJECTED
    await assert.rejects(
      commitCompletionReport({
        database,
        userId: fixture.userId,
        interviewId: fixture.interview.id,
        jobId: jobClaim.job.id,
        claimToken: jobClaim.claimToken,
        summary,
      }),
      /is not in scored status/,
    );

    // Insert scored row for Q1: (9, 9, 8, 8, 9, 8) -> sum = 51 -> 8.5
    await database.insert(questionScores).values({
      questionId: q1.id,
      understanding: 9,
      expression: 9,
      logic: 8,
      depth: 8,
      authenticity: 9,
      reflection: 8,
      overall: "8.5",
      feedbackJson: { strengths: ["a"], improvements: ["b"], advice: "c" },
      status: "scored",
      attemptCount: 1,
    });

    // Commit report -> SUCCEEDS and deterministically computes overall 85
    const report = await commitCompletionReport({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
      jobId: jobClaim.job.id,
      claimToken: jobClaim.claimToken,
      summary,
    });

    assert.equal(report.scoreStatus, "scored");
    assert.equal(report.overallScore, 85);

    // Verify interview status is completed and agentSession is idle
    const [updatedInterview] = await database.select().from(interviews).where(eq(interviews.id, fixture.interview.id));
    assert.equal(updatedInterview.status, "completed");

    const [updatedSession] = await database.select().from(agentSessions).where(eq(agentSessions.id, fixture.session.id));
    assert.equal(updatedSession.status, "idle");

    // Verify interview/completed event was emitted
    const events = await database.select().from(agentEvents).where(eq(agentEvents.sessionId, fixture.session.id));
    const completedEvent = events.find((e) => e.type === "interview/completed");
    assert.ok(completedEvent);
    assert.equal((completedEvent.payload as { overallScore: number }).overallScore, 85);
    assert.equal((completedEvent.payload as { scoreStatus: string }).scoreStatus, "scored");
    assert.equal((completedEvent.payload as { interviewId: string }).interviewId, fixture.interview.id);

    // Strengthen real producer-to-consumer contract test with transcript projection
    const { projectInterviewTranscript } = await import("./projections/transcript");
    const domainEvents: import("./projections/types").InterviewEventSnapshot[] = events.map((e) => ({
      sequence: e.sequence,
      type: e.type,
      payload: e.payload as Record<string, unknown>,
      visibility: e.visibility as "model" | "user" | "model_and_user" | "internal",
      schemaVersion: e.schemaVersion,
      dedupeKey: e.dedupeKey,
      runId: e.runId,
    }));

    const transcriptItems = projectInterviewTranscript({ events: domainEvents });
    assert.ok(Array.isArray(transcriptItems));
    // Completed event must not add extra visual transcript messages
    const visualCompletedItem = transcriptItems.find((m) => m.type === ("interview/completed" as never));
    assert.equal(visualCompletedItem, undefined);
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("executeInterviewCompletion executes end-to-end scoring, retry recovery, and report generation", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { executeInterviewCompletion } = await import("./application/execute-completion");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.insert(schema.agentRuns).values({
      sessionId: fixture.session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [run1] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-1",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run1.id,
      sequence: 1,
      kind: "main",
      topic: "System Design",
      question: "Design a rate limiter",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: fixture.interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "Use token bucket algorithm backed by Redis with atomic Lua scripts.",
      status: "answered",
    });

    await database.insert(interviewCompletionJobs).values({
      interviewId: fixture.interview.id,
      status: "pending",
      attemptCount: 0,
    });

    let scoringCalls = 0;
    let reportCalls = 0;

    type MockGenerateFn = NonNullable<Parameters<typeof executeInterviewCompletion>[1]>["generateStructured"];
    const mockGenerate: MockGenerateFn = async (options) => {
      if (options.task === "interview.question_scoring") {
        scoringCalls += 1;
        return {
          scores: { understanding: 9, expression: 9, logic: 8, depth: 8, authenticity: 9, reflection: 8 },
          strengths: ["Clear algorithmic choice"],
          improvements: ["Mention distributed clock sync"],
          advice: "Discuss Redis Cluster partitioning.",
        } as never;
      }
      if (options.task === "interview.report_generation") {
        reportCalls += 1;
        return {
          overallSummary: "Excellent architectural understanding.",
          keyStrengths: ["Strong systems background"],
          keyImprovements: ["Clarify multi-region edge cases"],
          recommendations: "Review distributed systems papers",
        } as never;
      }
      throw new Error(`Unexpected task: ${options.task}`);
    };

    const outcome = await executeInterviewCompletion(
      { interviewId: fixture.interview.id, userId: fixture.userId },
      { database, generateStructured: mockGenerate },
    );

    assert.equal(outcome.status, "completed");
    assert.equal(scoringCalls, 1);
    assert.equal(reportCalls, 1);

    const [finalReport] = await database.select().from(interviewReports).where(eq(interviewReports.interviewId, fixture.interview.id));
    assert.equal(finalReport.overallScore, 85);
    assert.equal(finalReport.scoreStatus, "scored");

    // Idempotent re-run on completed job returns completed without re-running models
    const rerunOutcome = await executeInterviewCompletion(
      { interviewId: fixture.interview.id, userId: fixture.userId },
      { database, generateStructured: mockGenerate },
    );
    assert.equal(rerunOutcome.status, "completed");
    assert.equal(scoringCalls, 1); // No new scoring calls!
    assert.equal(reportCalls, 1); // No new report calls!
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("executeInterviewCompletion terminates cleanly on persistent model failures without infinite loops, and blocks execution until retried", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
  timeout: 10000,
}, async () => {
  const { executeInterviewCompletion } = await import("./application/execute-completion");
  const { retryCompletionJob } = await import("./persistence/completion-repository");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.insert(schema.agentRuns).values({
      sessionId: fixture.session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [run1] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-1",
      status: "completed",
    }).returning();

    const [run2] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-2",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run1.id,
      sequence: 1,
      kind: "main",
      topic: "Concurrency",
      question: "Explain mutexes",
      status: "answered",
    }).returning();

    const [q2] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run2.id,
      sequence: 2,
      kind: "main",
      topic: "Memory",
      question: "Explain virtual memory",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values([
      {
        interviewId: fixture.interview.id,
        questionId: q1.id,
        submissionKey: "sub-1",
        submissionRequestHash: "hash-1",
        content: "A mutex provides mutual exclusion.",
        status: "answered",
      },
      {
        interviewId: fixture.interview.id,
        questionId: q2.id,
        submissionKey: "sub-2",
        submissionRequestHash: "hash-2",
        content: "Virtual memory maps virtual addresses to physical pages.",
        status: "answered",
      },
    ]);

    await database.insert(interviewCompletionJobs).values({
      interviewId: fixture.interview.id,
      status: "pending",
      attemptCount: 0,
    });

    let modelCalls = 0;
    type MockGenerateFn = NonNullable<Parameters<typeof executeInterviewCompletion>[1]>["generateStructured"];
    const failingGenerate: MockGenerateFn = async () => {
      modelCalls += 1;
      throw new Error("Model service unavailable: 503 Internal Error");
    };

    // 1. Execute completion with failing model
    const outcome = await executeInterviewCompletion(
      { interviewId: fixture.interview.id, userId: fixture.userId },
      { database, generateStructured: failingGenerate },
    );

    // 2. Assert results: exactly 2 model calls (one per question, no infinite loop!)
    assert.equal(outcome.status, "failed");
    assert.equal(modelCalls, 2);

    // 3. Verify DB state: Completion Job is failed
    const [job] = await database
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    assert.equal(job.status, "failed");
    assert.equal(job.claimToken, null);

    // 4. Verify question scores in DB: both failed, no claim tokens
    const scores = await database
      .select()
      .from(questionScores)
      .where(inArray(questionScores.questionId, [q1.id, q2.id]));
    assert.equal(scores.length, 2);
    assert.ok(scores.every((s) => s.status === "failed" && s.claimToken === null));

    // 5. Calling executeInterviewCompletion again WITHOUT retry must NOT call model and must return unavailable (failed)
    const unretriedOutcome = await executeInterviewCompletion(
      { interviewId: fixture.interview.id, userId: fixture.userId },
      { database, generateStructured: failingGenerate },
    );
    assert.equal(unretriedOutcome.status, "unavailable");
    assert.equal(unretriedOutcome.jobStatus, "failed");
    assert.equal(modelCalls, 2); // Model was NOT called again

    // 6. Explicit retry resets job & scores to pending
    const retryResult = await retryCompletionJob({
      database,
      userId: fixture.userId,
      interviewId: fixture.interview.id,
    });
    assert.equal(retryResult.state, "ready");

    const scoresAfterRetry = await database
      .select()
      .from(questionScores)
      .where(inArray(questionScores.questionId, [q1.id, q2.id]));
    assert.ok(scoresAfterRetry.every((s) => s.status === "pending" && s.claimToken === null));

    // 7. Next attempt with working model can score successfully
    let workingCalls = 0;
    const workingGenerate: MockGenerateFn = async (options) => {
      workingCalls += 1;
      if (options.task === "interview.question_scoring") {
        return {
          scores: { understanding: 9, expression: 8, logic: 9, depth: 8, authenticity: 8, reflection: 8 },
          strengths: ["Clear explanation"],
          improvements: ["Mention page faults"],
          advice: "Review OS concepts.",
        } as never;
      }
      return {
        overallSummary: "Good CS fundamentals.",
        keyStrengths: ["Strong systems logic"],
        keyImprovements: ["Include more implementation details"],
        recommendations: "Study Linux kernel architecture.",
      } as never;
    };

    const retriedOutcome = await executeInterviewCompletion(
      { interviewId: fixture.interview.id, userId: fixture.userId },
      { database, generateStructured: workingGenerate },
    );
    assert.equal(retriedOutcome.status, "completed");
    assert.equal(workingCalls, 3); // 2 questions scored + 1 report
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("handleEndInterview schedules on replayed End to recover pending/expired jobs without creating duplicate jobs and without bypassing failed retry", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { handleEndInterview } = await import("@/app/api/interviews/[id]/end/route");
  const { executeInterviewCompletion } = await import("./application/execute-completion");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    await database.insert(schema.agentRuns).values({
      sessionId: fixture.session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [run1] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-1",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: run1.id,
      sequence: 1,
      kind: "main",
      topic: "Algorithms",
      question: "Explain LRU cache",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: fixture.interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "Use a hash table and a doubly linked list.",
      status: "answered",
    });

    await database
      .update(interviews)
      .set({ status: "active" })
      .where(eq(interviews.id, fixture.interview.id));

    let modelCallCount = 0;
    type MockGenerateFn = NonNullable<Parameters<typeof executeInterviewCompletion>[1]>["generateStructured"];
    const mockGenerate: MockGenerateFn = async (options) => {
      modelCallCount += 1;
      if (options.task === "interview.question_scoring") {
        return {
          scores: { understanding: 9, expression: 9, logic: 9, depth: 8, authenticity: 9, reflection: 8 },
          strengths: ["Good explanation"],
          improvements: ["Mention concurrency locks"],
          advice: "Practice thread safety.",
        } as never;
      }
      return {
        overallSummary: "Strong algorithmic skill.",
        keyStrengths: ["Clear data structure choices"],
        keyImprovements: ["Consider thread safety"],
        recommendations: "Review concurrent data structures.",
      } as never;
    };

    const customExecutor: typeof executeInterviewCompletion = (input, deps) =>
      executeInterviewCompletion(input, { ...deps, database, generateStructured: mockGenerate });

    let scheduledTasks: (() => Promise<void>)[] = [];
    const scheduleRecorder = (task: () => Promise<void>) => {
      scheduledTasks.push(task);
    };

    // 1. Pending: First call to handleEndInterview creates pending job and schedules execution
    const firstEnd = await handleEndInterview(
      { userId: fixture.userId, interviewId: fixture.interview.id },
      { scheduleCompletion: scheduleRecorder, executeCompletion: customExecutor, database },
    );
    assert.equal(firstEnd.outcome.replayed, false);
    assert.equal(scheduledTasks.length, 1);

    // 2. Pending Recovery: Simulate worker did NOT run (simulating process death / stranded pending job)
    scheduledTasks = [];

    // Replayed End MUST STILL schedule execution!
    const secondEnd = await handleEndInterview(
      { userId: fixture.userId, interviewId: fixture.interview.id },
      { scheduleCompletion: scheduleRecorder, executeCompletion: customExecutor, database },
    );
    assert.equal(secondEnd.outcome.replayed, true);
    assert.equal(scheduledTasks.length, 1);

    // Execute the captured scheduled callback
    await scheduledTasks[0]();
    assert.equal(modelCallCount, 2); // 1 question score + 1 report

    // Verify only 1 completed job exists in database
    const jobs = await database
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "completed");

    // 3. Completed: Calling End on an already completed interview schedules, but executor exits immediately
    scheduledTasks = [];
    const completedEnd = await handleEndInterview(
      { userId: fixture.userId, interviewId: fixture.interview.id },
      { scheduleCompletion: scheduleRecorder, executeCompletion: customExecutor, database },
    );
    assert.equal(completedEnd.outcome.replayed, true);
    assert.equal(scheduledTasks.length, 1);

    await scheduledTasks[0]();
    assert.equal(modelCallCount, 2); // 0 new model calls

    // 4. Active (unexpired lease): Replay on an active job schedules, but executor does not preempt active worker
    await database
      .update(interviews)
      .set({ status: "completing" })
      .where(eq(interviews.id, fixture.interview.id));
    await database
      .update(interviewCompletionJobs)
      .set({
        status: "scoring",
        claimToken: "active-worker-token",
        claimExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));

    scheduledTasks = [];
    const activeEnd = await handleEndInterview(
      { userId: fixture.userId, interviewId: fixture.interview.id },
      { scheduleCompletion: scheduleRecorder, executeCompletion: customExecutor, database },
    );
    assert.equal(activeEnd.outcome.replayed, true);
    assert.equal(scheduledTasks.length, 1);

    await scheduledTasks[0]();
    assert.equal(modelCallCount, 2); // 0 new model calls; active worker not disturbed

    const [activeJob] = await database
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    assert.equal(activeJob.status, "scoring");
    assert.equal(activeJob.claimToken, "active-worker-token");

    // 5. Expired: Replay on an expired job schedules, executor takes over and finishes completion
    await database
      .update(interviews)
      .set({ status: "completing" })
      .where(eq(interviews.id, fixture.interview.id));
    await database
      .delete(interviewReports)
      .where(eq(interviewReports.interviewId, fixture.interview.id));
    await database
      .delete(agentEvents)
      .where(eq(agentEvents.sessionId, fixture.session.id));
    await database
      .update(interviewCompletionJobs)
      .set({
        status: "scoring",
        claimToken: "expired-token",
        claimExpiresAt: new Date(Date.now() - 5_000),
      })
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    await database
      .update(questionScores)
      .set({
        status: "scoring",
        claimToken: "expired-score-token",
        claimExpiresAt: new Date(Date.now() - 5_000),
      })
      .where(eq(questionScores.questionId, q1.id));

    scheduledTasks = [];
    const expiredEnd = await handleEndInterview(
      { userId: fixture.userId, interviewId: fixture.interview.id },
      { scheduleCompletion: scheduleRecorder, executeCompletion: customExecutor, database },
    );
    assert.equal(expiredEnd.outcome.replayed, true);
    assert.equal(scheduledTasks.length, 1);

    await scheduledTasks[0]();
    assert.equal(modelCallCount, 4); // Expired job was taken over and completed (+1 score, +1 report)

    const [takenOverJob] = await database
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    assert.equal(takenOverJob.status, "completed");

    // 6. Failed: Replay on a failed job schedules, but executor exits immediately without model calls or resetting scores
    await database
      .update(interviews)
      .set({ status: "completing" })
      .where(eq(interviews.id, fixture.interview.id));
    await database
      .update(interviewCompletionJobs)
      .set({
        status: "failed",
        claimToken: null,
        claimExpiresAt: null,
      })
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    await database
      .update(questionScores)
      .set({
        status: "failed",
        claimToken: null,
        claimExpiresAt: null,
      })
      .where(eq(questionScores.questionId, q1.id));

    scheduledTasks = [];
    const failedEnd = await handleEndInterview(
      { userId: fixture.userId, interviewId: fixture.interview.id },
      { scheduleCompletion: scheduleRecorder, executeCompletion: customExecutor, database },
    );
    assert.equal(failedEnd.outcome.replayed, true);
    assert.equal(scheduledTasks.length, 1);

    await scheduledTasks[0]();
    assert.equal(modelCallCount, 4); // 0 new model calls!

    const [failedJob] = await database
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    assert.equal(failedJob.status, "failed");

    const [failedScore] = await database
      .select()
      .from(questionScores)
      .where(eq(questionScores.questionId, q1.id));
    assert.equal(failedScore.status, "failed"); // NOT reset to pending
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("executeInterviewCompletion safely aborts when encountering contradictory scored row, without inserting report or completing interview", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { executeInterviewCompletion } = await import("@/lib/interview/application/execute-completion");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createInterviewFixture(database);

  try {
    const [logicalRun] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: fixture.interview.id,
      triggerType: "opening",
      triggerKey: "run-open-contradictory",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: fixture.interview.id,
      sourceInterviewRunId: logicalRun.id,
      sequence: 1,
      kind: "main",
      topic: "Topic 1",
      question: "Question 1",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: fixture.interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "Answer 1",
      status: "answered",
    });

    // Insert contradictory scored row: 6 dimensions all 8, but overall is "9.0"
    await database.insert(questionScores).values({
      questionId: q1.id,
      understanding: 8,
      expression: 8,
      logic: 8,
      depth: 8,
      authenticity: 8,
      reflection: 8,
      overall: "9.0",
      feedbackJson: {
        strengths: ["Good points"],
        improvements: ["Next steps"],
        advice: "Advice",
      },
      status: "scored",
      attemptCount: 1,
    });

    await database.insert(interviewCompletionJobs).values({
      interviewId: fixture.interview.id,
      status: "pending",
      attemptCount: 0,
    });

    // Mock generateStructured for report generation
    type MockGenerateFn = NonNullable<Parameters<typeof executeInterviewCompletion>[1]>["generateStructured"];
    const mockGenerate: MockGenerateFn = async () => {
      return {
        overallSummary: "Summary",
        keyStrengths: ["S1"],
        keyImprovements: ["I1"],
        recommendations: "R1",
      } as never;
    };

    const outcome = await executeInterviewCompletion(
      { interviewId: fixture.interview.id, userId: fixture.userId },
      { database, generateStructured: mockGenerate },
    );
    assert.equal(outcome.status, "failed");

    // 1. Report is NOT written
    const reports = await database
      .select()
      .from(interviewReports)
      .where(eq(interviewReports.interviewId, fixture.interview.id));
    assert.equal(reports.length, 0);

    // 2. Interview remains in 'completing' status (NOT completed)
    const [interview] = await database
      .select()
      .from(interviews)
      .where(eq(interviews.id, fixture.interview.id));
    assert.equal(interview.status, "completing");

    // 3. Job is marked 'failed'
    const [job] = await database
      .select()
      .from(interviewCompletionJobs)
      .where(eq(interviewCompletionJobs.interviewId, fixture.interview.id));
    assert.equal(job.status, "failed");
    assert.ok(job.errorJson);
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});
