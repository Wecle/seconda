import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  interviewAgentToolCommits,
  interviewAnswerAssessments,
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
import { createDrizzleCompletionJobRepository } from "../completion/repository";
import { createDrizzleAgentInterviewStore } from "./drizzle-store";
import { createDrizzleInterviewAgentRepository } from "./repository";
import { ensureLatestAnswerAssessment } from "./assessment-service";

test("real database fences stale workers and preserves atomic idempotency under concurrency", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const resumeId = randomUUID();
  const versionId = randomUUID();
  let interviewId: string | null = null;

  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.test` });
    await db.insert(resumes).values({ id: resumeId, userId, title: "Concurrency resume" });
    await db.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      originalFilename: "resume.pdf",
      storedPath: `https://blob.example/${versionId}.pdf`,
      extractedText: "TypeScript distributed systems",
      parsedJson: { name: "Candidate", title: "Engineer", skills: ["TypeScript"], experience: [], education: [], projects: [], summary: "" },
      parseStatus: "parsed",
    });
    const store = createDrizzleAgentInterviewStore(db);
    const created = await store.createInterview({
      ownerUserId: userId,
      idempotencyKey: randomUUID(),
      resumeVersionId: versionId,
      config: { configVersion: 2, language: "zh", persona: "standard", preference: "", preferenceTags: [] },
    });
    interviewId = created.interviewId;
    await store.initializeCoverage(interviewId);

    const repository = createDrizzleInterviewAgentRepository(db);
    const runs = await Promise.all(Array.from({ length: 4 }, () => repository.createRun({
      interviewId: interviewId!,
      idempotencyKey: "same-run",
    })));
    assert.equal(new Set(runs.map((run) => run.id)).size, 1);
    const runId = runs[0].id;
    await repository.saveRunTrigger(runId, { mode: "answer", instruction: "resume after crash" });

    const startedAt = new Date();
    const firstClaim = await repository.claimRun(runId, "worker-a", startedAt, 1_000);
    assert.equal(firstClaim.claimed, true);
    const firstLease = { owner: "worker-a", generation: firstClaim.run!.leaseGeneration };
    await repository.saveCheckpoint(runId, {
      turnCount: 2,
      toolCallCount: 1,
      lastEventSequence: 0,
      progressHash: "before-crash",
      activeSkillNames: [],
    }, firstLease);

    const secondClaim = await repository.claimRun(runId, "worker-b", new Date(startedAt.getTime() + 2_000), 60_000);
    assert.equal(secondClaim.claimed, true);
    assert.equal(secondClaim.run?.checkpoint?.progressHash, "before-crash");
    const secondLease = { owner: "worker-b", generation: secondClaim.run!.leaseGeneration };
    await assert.rejects(
      repository.appendEvent(runId, { type: "warning", payload: {} }, firstLease),
      /lease/i,
    );

    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => repository.commitQuestionOutcome({
      runId,
      interviewId: interviewId!,
      toolCallId: `question-${index}`,
      lease: secondLease,
      category: "technical_depth",
      topic: `topic-${index}`,
      question: `问题 ${index + 1}？`,
      responseText: `问题 ${index + 1}？`,
      resumeEvidenceIds: ["resume:structured"],
    })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const fulfilledIndex = results.findIndex((result) => result.status === "fulfilled");
    const fulfilled = results[fulfilledIndex] as PromiseFulfilledResult<{ questionId: string }>;
    const replay = await repository.commitQuestionOutcome({
      runId,
      interviewId,
      toolCallId: `question-${fulfilledIndex}`,
      lease: secondLease,
      category: "technical_depth",
      topic: `topic-${fulfilledIndex}`,
      question: `问题 ${fulfilledIndex + 1}？`,
      responseText: `问题 ${fulfilledIndex + 1}？`,
      resumeEvidenceIds: ["resume:structured"],
    });
    assert.equal(replay.questionId, fulfilled.value.questionId);

    const [questions, messages, commits, coverage] = await Promise.all([
      db.select().from(interviewQuestions).where(eq(interviewQuestions.interviewId, interviewId)),
      db.select().from(interviewMessages).where(eq(interviewMessages.interviewId, interviewId)),
      db.select().from(interviewAgentToolCommits).where(eq(interviewAgentToolCommits.runId, runId)),
      db.select().from(interviewCoverage).where(and(
        eq(interviewCoverage.interviewId, interviewId),
        eq(interviewCoverage.category, "technical_depth"),
        eq(interviewCoverage.topic, "__category__"),
      )),
    ]);
    assert.equal(questions.length, 3);
    assert.equal(messages.length, 3);
    assert.equal(commits.length, 3);
    assert.equal(coverage[0].questionCount, 3);

    const answerEndRace = await Promise.allSettled([
      store.acceptCandidateMessage({
        interviewId,
        content: "A concurrently accepted answer",
        idempotencyKey: randomUUID(),
        runIdempotencyKey: `message:${randomUUID()}`,
        trigger: { mode: "answer", instruction: "continue from the accepted answer" },
      }),
      repository.markInterviewCompleting(interviewId),
    ]);
    assert.equal(answerEndRace[1].status, "fulfilled");
    const postEndRuns = await db.select().from(schema.interviewAgentRuns)
      .where(eq(schema.interviewAgentRuns.interviewId, interviewId));
    assert.equal(postEndRuns.some((candidate) => candidate.status === "running" && candidate.triggerJson === null), false);

    const completion = createDrizzleCompletionJobRepository(db);
    const job = await completion.createJob(interviewId);
    const firstCompletion = await completion.claimJob(job.id, "completion-a", startedAt, 1_000);
    const secondCompletion = await completion.claimJob(job.id, "completion-b", new Date(startedAt.getTime() + 2_000), 60_000);
    assert.ok(firstCompletion && secondCompletion);
    assert.equal(secondCompletion.attemptCount, 2);
    assert.equal(await completion.completeJob(job.id, { owner: "completion-a", generation: firstCompletion.leaseGeneration }), false);
    assert.equal(await completion.completeJob(job.id, { owner: "completion-b", generation: secondCompletion.leaseGeneration }), true);
  } finally {
    try {
      if (interviewId) await db.delete(interviews).where(eq(interviews.id, interviewId));
      await db.delete(resumes).where(eq(resumes.id, resumeId));
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("interview creation idempotency is scoped to the owner and immutable request", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  const ids = {
    users: [randomUUID(), randomUUID()],
    resumes: [randomUUID(), randomUUID()],
    versions: [randomUUID(), randomUUID()],
  };
  const interviewIds: string[] = [];
  try {
    await db.insert(users).values(ids.users.map((id) => ({ id, email: `${id}@example.test` })));
    await db.insert(resumes).values(ids.resumes.map((id, index) => ({ id, userId: ids.users[index], title: `Resume ${index}` })));
    await db.insert(resumeVersions).values(ids.versions.map((id, index) => ({
      id,
      resumeId: ids.resumes[index],
      versionNumber: 1,
      originalFilename: `resume-${index}.pdf`,
      storedPath: `https://blob.example/${id}.pdf`,
      extractedText: "TypeScript",
      parsedJson: { name: "Candidate", skills: ["TypeScript"], experience: [], education: [], projects: [], summary: "" },
      parseStatus: "parsed",
    })));
    const key = randomUUID();
    const store = createDrizzleAgentInterviewStore(db);
    const created = await Promise.all(ids.users.map((ownerUserId, index) => store.createInterview({
      ownerUserId,
      idempotencyKey: key,
      resumeVersionId: ids.versions[index],
      config: { configVersion: 2, language: "zh", persona: "standard", preference: "", preferenceTags: [] },
    })));
    interviewIds.push(...created.map((item) => item.interviewId));
    assert.equal(new Set(interviewIds).size, 2);
    await assert.rejects(store.createInterview({
      ownerUserId: ids.users[0],
      idempotencyKey: key,
      resumeVersionId: ids.versions[0],
      config: { configVersion: 2, language: "en", persona: "standard", preference: "", preferenceTags: [] },
    }), /different interview request/);
  } finally {
    try {
      for (const interviewId of interviewIds) await db.delete(interviews).where(eq(interviews.id, interviewId));
      for (const resumeId of ids.resumes) await db.delete(resumes).where(eq(resumes.id, resumeId));
      for (const userId of ids.users) await db.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("durable assessment claims prevent duplicate model calls and fence commits", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const resumeId = randomUUID();
  const versionId = randomUUID();
  let interviewId: string | null = null;
  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.test` });
    await db.insert(resumes).values({ id: resumeId, userId, title: "Assessment resume" });
    await db.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      originalFilename: "resume.pdf",
      storedPath: `https://blob.example/${versionId}.pdf`,
      extractedText: "Built resilient TypeScript services",
      parsedJson: { name: "Candidate", skills: ["TypeScript"], experience: [], education: [], projects: [], summary: "" },
      parseStatus: "parsed",
    });
    const store = createDrizzleAgentInterviewStore(db);
    const created = await store.createInterview({
      ownerUserId: userId,
      idempotencyKey: randomUUID(),
      resumeVersionId: versionId,
      config: { configVersion: 2, language: "zh", persona: "standard", preference: "", preferenceTags: [] },
    });
    interviewId = created.interviewId;
    await store.initializeCoverage(interviewId);
    const repository = createDrizzleInterviewAgentRepository(db);
    const run = await repository.createRun({ interviewId, idempotencyKey: "assessment-run" });
    await repository.saveRunTrigger(run.id, { mode: "answer", instruction: "assess" });
    const claimed = await repository.claimRun(run.id, "assessment-worker", new Date(), 60_000);
    assert.equal(claimed.claimed, true);
    const lease = { owner: "assessment-worker", generation: claimed.run!.leaseGeneration };
    const [question] = await db.insert(interviewQuestions).values({
      interviewId,
      questionIndex: 1,
      questionType: "technical_depth",
      topic: "resilience",
      question: "How did you make the service resilient?",
      answerText: "I used idempotency and leases.",
      answeredAt: new Date(),
    }).returning({ id: interviewQuestions.id });
    await db.insert(interviewMessages).values({
      interviewId,
      runId: run.id,
      sequence: 1,
      role: "user",
      kind: "answer",
      content: "I used idempotency and leases.",
      questionId: question.id,
    });
    let releaseAssessment!: () => void;
    const assessmentGate = new Promise<void>((resolve) => { releaseAssessment = resolve; });
    let calls = 0;
    const assess = async () => {
      calls += 1;
      await assessmentGate;
      return {
        completeness: "high" as const,
        specificity: "high" as const,
        evidenceStrength: "strong" as const,
        reflectionDepth: "deep" as const,
        followUpNeeded: false,
        missingPoints: [],
        extractedEvidence: ["idempotency and leases"],
        publicSummary: "回答提供了具体的可靠性证据。",
      };
    };
    const first = ensureLatestAnswerAssessment(db, { interviewId, runId: run.id, lease, assess });
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    await assert.rejects(
      ensureLatestAnswerAssessment(db, { interviewId, runId: run.id, lease, assess }),
      /already in progress/,
    );
    releaseAssessment();
    await first;
    assert.equal(calls, 1);
    const stored = await db.select().from(interviewAnswerAssessments)
      .where(eq(interviewAnswerAssessments.interviewId, interviewId));
    assert.equal(stored.length, 1);
  } finally {
    try {
      if (interviewId) await db.delete(interviews).where(eq(interviews.id, interviewId));
      await db.delete(resumes).where(eq(resumes.id, resumeId));
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});
