import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
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

const databaseUrl = process.env.DATABASE_URL;

test("report API returns 404 for non-owner and returns structured report data for owner without leaking internal errors", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { getInterviewReport } = await import("@/app/api/interviews/[id]/report/route");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  await database.insert(users).values([
    { id: ownerId, email: `${ownerId}@example.test` },
    { id: outsiderId, email: `${outsiderId}@example.test` },
  ]);

  try {
    const [resume] = await database.insert(resumes).values({ userId: ownerId, title: "Owner Resume" }).returning();
    const [version] = await database.insert(resumeVersions).values({
      resumeId: resume.id,
      versionNumber: 1,
      sourceType: "generated",
      parsedJson: { name: "Candidate" },
      extractedText: "Candidate Resume Text",
    }).returning();

    const [session] = await database.insert(agentSessions).values({
      userId: ownerId,
      title: "Session",
      model: "claude-3-5-haiku-latest",
      capability: "interview",
      promptVersion: "interview-agent-v1",
      systemPrompt: "System",
      status: "idle",
    }).returning();

    const [interview] = await database.insert(interviews).values({
      userId: ownerId,
      creationIdempotencyKey: randomUUID(),
      creationRequestHash: "hash-1",
      resumeVersionId: version.id,
      agentSessionId: session.id,
      language: "zh",
      persona: "standard",
      interviewType: "technical",
      targetLevel: "Senior",
      targetRole: "Frontend Engineer",
      targetRoundCount: 2,
      status: "completed",
    }).returning();

    await database.insert(interviewResumeSnapshots).values({
      interviewId: interview.id,
      resumeId: resume.id,
      resumeVersionId: version.id,
      resumeTitle: resume.title,
      versionNumber: version.versionNumber,
      sourceType: version.sourceType,
      parsedJson: version.parsedJson!,
      canonicalText: "Candidate Resume Text",
      evidenceJson: {},
      contentHash: "hash",
    });

    await database.insert(schema.agentRuns).values({
      sessionId: session.id,
      maxSteps: 3,
      status: "completed",
    });
    const [logicalRun] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: interview.id,
      currentAgentRunId: null,
      triggerType: "opening",
      triggerKey: "run-open",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: logicalRun.id,
      sequence: 1,
      kind: "main",
      topic: "React Rendering",
      question: "How does reconciliation work?",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "Fiber tree diffing with keys and component types.",
      status: "answered",
    });

    await database.insert(questionScores).values({
      questionId: q1.id,
      understanding: 9,
      expression: 8,
      logic: 9,
      depth: 8,
      authenticity: 9,
      reflection: 8,
      overall: "8.5",
      feedbackJson: {
        strengths: ["Deep fiber knowledge"],
        improvements: ["Discuss fiber priority queues"],
        advice: "Mention lane model in React 18.",
      },
      status: "scored",
      attemptCount: 1,
    });

    await database.insert(interviewCompletionJobs).values({
      interviewId: interview.id,
      status: "completed",
      completedAt: new Date(),
      attemptCount: 1,
    });

    await database.insert(interviewReports).values({
      interviewId: interview.id,
      overallScore: 85,
      dimensionAveragesJson: {
        understanding: 9.0,
        expression: 8.0,
        logic: 9.0,
        depth: 8.0,
        authenticity: 9.0,
        reflection: 8.0,
      },
      summaryJson: {
        overallSummary: "Strong React core expertise.",
        keyStrengths: ["Clear architectural articulation"],
        keyImprovements: ["Include concurrent scheduling details"],
        recommendations: "Study React Fiber codebase",
      },
      scoreStatus: "scored",
    }).returning();

    // 1. Non-owner gets 404
    const outsiderResponse = await getInterviewReport(
      { userId: outsiderId, interviewId: interview.id },
      { database },
    );
    assert.equal(outsiderResponse.status, 404);

    // 2. Owner gets 200 with full details
    const ownerResponse = await getInterviewReport(
      { userId: ownerId, interviewId: interview.id },
      { database },
    );
    assert.equal(ownerResponse.status, 200);
    const body = ownerResponse.body as unknown as {
      interview: { id: string; targetRole: string };
      job: { id: string; status: string; errorJson?: unknown };
      report: { overallScore: number; scoreStatus: string };
      questions: Array<{ sequence: number; scores: { understanding: number } | null; overall: number | null }>;
    };
    assert.equal(body.interview.id, interview.id);
    assert.equal(body.report.overallScore, 85);
    assert.equal(body.report.scoreStatus, "scored");
    assert.equal(body.job.status, "completed");
    assert.equal(body.job.errorJson, undefined); // errorJson is NOT leaked to client!
    assert.equal(body.questions.length, 1);
    assert.equal(body.questions[0].scores?.understanding, 9);
    assert.equal(body.questions[0].overall, 8.5);
  } finally {
    try {
      await database.delete(users).where(eq(users.id, ownerId));
      await database.delete(users).where(eq(users.id, outsiderId));
    } finally {
      await client.end();
    }
  }
});

test("retry API returns 404 for non-owner, 409 for active jobs, and 202 for failed jobs", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { handleRetryCompletion } = await import("@/app/api/interviews/[id]/completion/retry/route");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  await database.insert(users).values([
    { id: ownerId, email: `${ownerId}@example.test` },
    { id: outsiderId, email: `${outsiderId}@example.test` },
  ]);

  try {
    const [resume] = await database.insert(resumes).values({ userId: ownerId, title: "Owner Resume" }).returning();
    const [version] = await database.insert(resumeVersions).values({
      resumeId: resume.id,
      versionNumber: 1,
      sourceType: "generated",
      parsedJson: { name: "Candidate" },
      extractedText: "Candidate Resume Text",
    }).returning();

    const [session] = await database.insert(agentSessions).values({
      userId: ownerId,
      title: "Session",
      model: "claude-3-5-haiku-latest",
      capability: "interview",
      promptVersion: "interview-agent-v1",
      systemPrompt: "System",
      status: "running",
    }).returning();

    const [interview] = await database.insert(interviews).values({
      userId: ownerId,
      creationIdempotencyKey: randomUUID(),
      creationRequestHash: "hash-2",
      resumeVersionId: version.id,
      agentSessionId: session.id,
      language: "zh",
      persona: "standard",
      interviewType: "technical",
      targetLevel: "Senior",
      targetRole: "Frontend Engineer",
      targetRoundCount: 2,
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
      canonicalText: "Candidate Resume Text",
      evidenceJson: {},
      contentHash: "hash",
    });

    const [job] = await database.insert(interviewCompletionJobs).values({
      interviewId: interview.id,
      status: "scoring",
      claimToken: randomUUID(),
      claimExpiresAt: new Date(Date.now() + 60_000), // Active valid lease!
      attemptCount: 1,
    }).returning();

    // 1. Non-owner returns 404
    const outsiderResult = await handleRetryCompletion(
      { userId: outsiderId, interviewId: interview.id },
      { database },
    );
    assert.equal(outsiderResult.status, 404);

    // 2. Active valid job retry returns 409
    const activeResult = await handleRetryCompletion(
      { userId: ownerId, interviewId: interview.id },
      { database },
    );
    assert.equal(activeResult.status, 409);

    // 3. Mark job as failed
    await database.update(interviewCompletionJobs).set({
      status: "failed",
      claimToken: null,
      claimExpiresAt: null,
      errorJson: { code: "UPSTREAM_API_ERROR", category: "api", retryable: true },
    }).where(eq(interviewCompletionJobs.id, job.id));

    // 4. Failed job retry returns 202
    const failedRetryResult = await handleRetryCompletion(
      { userId: ownerId, interviewId: interview.id },
      { database },
    );
    assert.equal(failedRetryResult.status, 202);

    const [refreshedJob] = await database.select().from(interviewCompletionJobs).where(eq(interviewCompletionJobs.id, job.id));
    assert.equal(refreshedJob.status, "pending");
  } finally {
    try {
      await database.delete(users).where(eq(users.id, ownerId));
      await database.delete(users).where(eq(users.id, outsiderId));
    } finally {
      await client.end();
    }
  }
});

test("report API rejects mathematically contradictory single question overall with INVALID_REPORT_DATA and sanitizes un-scored questions", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { getInterviewReport } = await import("@/app/api/interviews/[id]/report/route");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const ownerId = randomUUID();
  await database.insert(users).values({ id: ownerId, email: `${ownerId}@example.test` });

  try {
    const [resume] = await database.insert(resumes).values({ userId: ownerId, title: "Resume" }).returning();
    const [version] = await database.insert(resumeVersions).values({
      resumeId: resume.id,
      versionNumber: 1,
      sourceType: "generated",
      parsedJson: { name: "Candidate" },
    }).returning();

    const [session] = await database.insert(agentSessions).values({
      userId: ownerId,
      title: "Session",
      model: "claude-3-5-haiku-latest",
      capability: "interview",
      promptVersion: "interview-agent-v1",
      systemPrompt: "System",
      status: "idle",
    }).returning();

    const [interview] = await database.insert(interviews).values({
      userId: ownerId,
      creationIdempotencyKey: randomUUID(),
      creationRequestHash: "hash-contradictory",
      resumeVersionId: version.id,
      agentSessionId: session.id,
      language: "zh",
      persona: "standard",
      interviewType: "technical",
      targetLevel: "Senior",
      targetRole: "Engineer",
      targetRoundCount: 2,
      status: "completed",
    }).returning();

    const [logicalRun] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: interview.id,
      triggerType: "opening",
      triggerKey: "run-open-test",
      status: "completed",
    }).returning();

    const [q1] = await database.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: logicalRun.id,
      sequence: 1,
      kind: "main",
      topic: "Topic 1",
      question: "Question 1",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: interview.id,
      questionId: q1.id,
      submissionKey: "sub-1",
      submissionRequestHash: "hash-1",
      content: "Answer 1",
      status: "answered",
    });

    // 1. Insert contradictory question score: 6 dimensions all 8, but overall is "9.0"
    const [score1] = await database.insert(questionScores).values({
      questionId: q1.id,
      understanding: 8,
      expression: 8,
      logic: 8,
      depth: 8,
      authenticity: 8,
      reflection: 8,
      overall: "9.0",
      feedbackJson: {
        strengths: ["Strong points"],
        improvements: ["Areas to grow"],
        advice: "Next steps",
      },
      status: "scored",
      attemptCount: 1,
    }).returning();

    await database.insert(interviewReports).values({
      interviewId: interview.id,
      overallScore: 80,
      dimensionAveragesJson: {
        understanding: 8.0,
        expression: 8.0,
        logic: 8.0,
        depth: 8.0,
        authenticity: 8.0,
        reflection: 8.0,
      },
      summaryJson: {
        overallSummary: "Summary",
        keyStrengths: ["Strength 1"],
        keyImprovements: ["Improvement 1"],
        recommendations: "Rec 1",
      },
      scoreStatus: "scored",
    });

    // Calling getInterviewReport MUST reject with INVALID_REPORT_DATA
    await assert.rejects(
      () => getInterviewReport({ userId: ownerId, interviewId: interview.id }, { database }),
      (err: unknown) =>
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "INVALID_REPORT_DATA",
    );

    // 2. Fix q1 score overall to "8.0", now report loads successfully
    await database.update(questionScores).set({ overall: "8.0" }).where(eq(questionScores.id, score1.id));
    const validReport = await getInterviewReport({ userId: ownerId, interviewId: interview.id }, { database });
    assert.equal(validReport.status, 200);

    // 3. Add a second question q2 in "failed" state with residual score columns populated in DB
    const [logicalRun2] = await database.insert(schema.interviewAgentRuns).values({
      interviewId: interview.id,
      triggerType: "opening",
      triggerKey: "run-open-test-2",
      status: "completed",
    }).returning();

    const [q2] = await database.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: logicalRun2.id,
      sequence: 2,
      kind: "follow_up",
      topic: "Topic 2",
      question: "Question 2",
      status: "answered",
    }).returning();

    await database.insert(interviewAnswers).values({
      interviewId: interview.id,
      questionId: q2.id,
      submissionKey: "sub-2",
      submissionRequestHash: "hash-2",
      content: "Answer 2",
      status: "answered",
    });

    await database.insert(questionScores).values({
      questionId: q2.id,
      understanding: 5,
      expression: 5,
      logic: 5,
      depth: 5,
      authenticity: 5,
      reflection: 5,
      overall: "5.0",
      feedbackJson: { strengths: ["a"], improvements: ["b"], advice: "c" },
      status: "failed",
      attemptCount: 1,
    });

    const reportWithFailedQ = await getInterviewReport({ userId: ownerId, interviewId: interview.id }, { database });
    assert.equal(reportWithFailedQ.status, 200);
    const body = reportWithFailedQ.body as {
      questions: Array<{
        id: string;
        scoreStatus: string | null;
        scores: unknown;
        overall: unknown;
        feedback: unknown;
      }>;
    };
    const failedQ = body.questions.find((q) => q.id === q2.id);
    assert.ok(failedQ);
    assert.equal(failedQ.scoreStatus, "failed");
    assert.equal(failedQ.scores, null);
    assert.equal(failedQ.overall, null);
    assert.equal(failedQ.feedback, null);
  } finally {
    try {
      await database.delete(users).where(eq(users.id, ownerId));
    } finally {
      await client.end();
    }
  }
});
