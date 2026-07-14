import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  interviewAgentEvents,
  interviewAgentRuns,
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
import type { AgentEventInput } from "./contracts";
import { createDrizzleAgentInterviewStore } from "./drizzle-store";
import { createDrizzleInterviewAgentRepository } from "./repository";
import { hashTurnProposalPrefix, type TurnProposalPrefix } from "./turn-proposal";

function publicReasoningEvent(
  runId: string,
  attemptId: string,
  logicalMessageId: string,
  text: string,
): AgentEventInput {
  return {
    type: "reasoning_delta",
    visibility: "public",
    attemptId,
    logicalMessageId,
    payload: { runId, attemptId, entryId: `reasoning:${attemptId}`, text },
  };
}

function postgresClockMilliseconds() {
  return sql<number>`FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision`;
}

test("real database fences stale workers, notifies durable events and preserves atomic idempotency", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  let listener: ReturnType<typeof postgres> | null = null;
  let unlisten: (() => Promise<void>) | null = null;
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

    const notifications: Array<{ runId: string; latestSequence: number }> = [];
    listener = postgres(process.env.DATABASE_URL!, { prepare: false });
    const listenRequest = await listener.listen("interview_agent_events", (value) => {
      try {
        const parsed = JSON.parse(value) as { runId?: unknown; latestSequence?: unknown };
        if (parsed.runId === runId && typeof parsed.latestSequence === "number") {
          notifications.push({ runId: parsed.runId, latestSequence: parsed.latestSequence });
        }
      } catch {
        return;
      }
    });
    unlisten = () => listenRequest.unlisten();
    const notifiedEvent = {
      type: "reasoning_started" as const,
      visibility: "public" as const,
      attemptId: "attempt-notify",
      logicalMessageId: "message-notify",
      payload: {
        runId,
        attemptId: "attempt-notify",
        entryId: "reasoning:attempt-notify",
      },
      dedupeKey: "reasoning-started:attempt-notify",
    };
    const [firstAppend, deduplicatedAppend] = await Promise.all([
      repository.appendEvent(runId, notifiedEvent, secondLease),
      repository.appendEvent(runId, notifiedEvent, secondLease),
    ]);
    await waitUntil(() => notifications.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(firstAppend.sequence, 1);
    assert.equal(deduplicatedAppend.sequence, 1);
    assert.deepEqual(notifications, [{ runId, latestSequence: firstAppend.sequence }]);

    await repository.appendEvent(runId, { type: "checkpoint", payload: { progress: 1 } }, secondLease);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(notifications, [{ runId, latestSequence: firstAppend.sequence }]);
    const persistedEvents = await repository.listEvents(runId, 0);
    const publicEvents = await repository.listEvents(runId, 0, { visibility: "public" });
    assert.equal(persistedEvents.length, 2);
    assert.equal(persistedEvents[0].runId, runId);
    assert.equal(persistedEvents[0].attemptId, "attempt-notify");
    assert.equal(persistedEvents[0].logicalMessageId, "message-notify");
    assert.equal(new Date(persistedEvents[0].createdAt).toISOString(), persistedEvents[0].createdAt);
    assert.equal(persistedEvents[1].visibility, "internal");
    assert.equal(persistedEvents[1].attemptId, null);
    assert.equal(persistedEvents[1].logicalMessageId, null);
    assert.deepEqual(publicEvents.map((event) => event.type), ["reasoning_started"]);

    const firstReasoning = await repository.appendEvent(
      runId,
      publicReasoningEvent(runId, "attempt-replay", "message-replay", "甲"),
      secondLease,
    );
    const secondReasoning = await repository.appendEvent(
      runId,
      publicReasoningEvent(runId, "attempt-replay", "message-replay", "乙"),
      secondLease,
    );
    const replayedReasoning = await repository.listEvents(
      runId,
      firstReasoning.sequence,
      { visibility: "public" },
    );
    assert.deepEqual(
      replayedReasoning.map((event) => ({
        sequence: event.sequence,
        attemptId: event.attemptId,
        logicalMessageId: event.logicalMessageId,
        payload: event.payload,
      })),
      [{
        sequence: secondReasoning.sequence,
        attemptId: "attempt-replay",
        logicalMessageId: "message-replay",
        payload: {
          runId,
          attemptId: "attempt-replay",
          entryId: "reasoning:attempt-replay",
          text: "乙",
        },
      }],
    );
    await assert.rejects(
      repository.appendEvent(
        runId,
        publicReasoningEvent(runId, "attempt-stale", "message-replay", "丙"),
        firstLease,
      ),
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

    const legacyTerminal = await repository.appendEvent(runId, {
      type: "run_failed",
      visibility: "public",
      payload: {
        runId,
        exitReason: "aborted_streaming",
        retryable: true,
        userMessage: "old failure",
      },
    }, secondLease);
    const [terminationStartedAt] = await db.select({
      value: postgresClockMilliseconds(),
    }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId)).limit(1);
    const expectedBackoffMs = Math.min(
      300_000,
      30_000 * (2 ** secondClaim.run!.resumeCount),
    );
    const terminated = await repository.terminateRun(runId, {
      exitReason: "aborted_streaming",
      error: new Error("fixture provider failure"),
    }, secondLease);
    const [terminationFinishedAt] = await db.select({
      value: postgresClockMilliseconds(),
    }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId)).limit(1);

    assert.equal(terminated.status, "failed");
    assert.equal(terminated.created, true);

    const [failedRun] = await db.select({
      status: interviewAgentRuns.status,
      leaseOwner: interviewAgentRuns.leaseOwner,
      leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
      nextResumeAt: interviewAgentRuns.nextResumeAt,
      lastEventSequence: interviewAgentRuns.lastEventSequence,
    }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId));

    assert.equal(failedRun.status, "failed");
    assert.equal(failedRun.leaseOwner, null);
    assert.equal(failedRun.leaseExpiresAt, null);
    assert.ok(failedRun.nextResumeAt);
    assert.ok(
      failedRun.nextResumeAt.getTime()
        >= terminationStartedAt.value + expectedBackoffMs,
    );
    assert.ok(
      failedRun.nextResumeAt.getTime()
        <= terminationFinishedAt.value + expectedBackoffMs,
    );

    const replayedTermination = await repository.terminateRun(runId, {
      exitReason: "aborted_streaming",
      error: new Error("fixture replay"),
    }, secondLease);
    assert.equal(replayedTermination.created, false);

    const terminalEvents = await db.select({
      sequence: interviewAgentEvents.sequence,
      type: interviewAgentEvents.type,
      visibility: interviewAgentEvents.visibility,
    }).from(interviewAgentEvents).where(and(
      eq(interviewAgentEvents.runId, runId),
      inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
    )).orderBy(asc(interviewAgentEvents.sequence));
    assert.deepEqual(terminalEvents, [
      {
        sequence: legacyTerminal.sequence,
        type: "run_failed",
        visibility: "internal",
      },
      {
        sequence: failedRun.lastEventSequence,
        type: "run_failed",
        visibility: "public",
      },
    ]);

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
      try {
        if (unlisten) await unlisten();
      } finally {
        try {
          if (listener) await listener.end();
        } finally {
          await client.end();
        }
      }
    }
  }
});

test("real database atomically commits an authorized turn and rolls back policy failures", {
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
    await db.insert(resumes).values({ id: resumeId, userId, title: "Atomic turn resume" });
    await db.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      originalFilename: "resume.pdf",
      storedPath: `https://blob.example/${versionId}.pdf`,
      extractedText: "Built lease-based idempotent TypeScript services",
      parsedJson: {
        name: "Candidate",
        title: "Engineer",
        skills: ["TypeScript"],
        experience: [],
        education: [],
        projects: [],
        summary: "",
      },
      parseStatus: "parsed",
    });
    const store = createDrizzleAgentInterviewStore(db);
    const created = await store.createInterview({
      ownerUserId: userId,
      idempotencyKey: randomUUID(),
      resumeVersionId: versionId,
      config: {
        configVersion: 2,
        language: "zh",
        persona: "standard",
        preference: "",
        preferenceTags: [],
      },
    });
    interviewId = created.interviewId;
    await store.initializeCoverage(interviewId);
    await db.update(interviews).set({ candidateRoundCount: 1 })
      .where(eq(interviews.id, interviewId));

    const [answeredQuestion] = await db.insert(interviewQuestions).values({
      interviewId,
      questionIndex: 1,
      questionType: "technical_depth",
      topic: "reliability",
      question: "你如何保证服务可靠性？",
      answerText: "我使用租约和幂等键。",
      answeredAt: new Date(),
    }).returning({ id: interviewQuestions.id });
    await db.update(interviewCoverage).set({
      questionCount: 1,
      status: "partial",
    }).where(and(
      eq(interviewCoverage.interviewId, interviewId),
      eq(interviewCoverage.category, "technical_depth"),
      eq(interviewCoverage.topic, "__category__"),
    ));
    const [answerMessage] = await db.insert(interviewMessages).values({
      interviewId,
      sequence: 1,
      role: "user",
      kind: "answer",
      content: "我使用租约和幂等键。",
      questionId: answeredQuestion.id,
    }).returning({ id: interviewMessages.id });

    const repository = createDrizzleInterviewAgentRepository(db);
    const run = await repository.createRun({
      interviewId,
      idempotencyKey: "authorized-turn",
    });
    await db.update(interviewMessages).set({ runId: run.id })
      .where(eq(interviewMessages.id, answerMessage.id));
    const claimed = await repository.claimRun(run.id, "turn-worker", new Date(), 60_000);
    const lease = {
      owner: "turn-worker",
      generation: claimed.run!.leaseGeneration,
    };
    const attemptId = "attempt-atomic";
    const logicalMessageId = randomUUID();
    await repository.startAttempt(run.id, {
      model: "test-model",
      attemptId,
      attemptNumber: 1,
      provisionalMessageId: logicalMessageId,
      now: new Date(),
    }, lease);
    const proposal: TurnProposalPrefix = {
      assessment: {
        completeness: "high",
        specificity: "high",
        evidenceStrength: "strong",
        reflectionDepth: "surface",
        followUpNeeded: false,
        missingPoints: ["失效边界"],
        extractedEvidence: ["租约和幂等键"],
        publicSummary: "回答包含可靠性机制，但仍需验证失效边界。",
      },
      coverageChanges: [{
        category: "technical_depth",
        topic: "可靠性机制",
        status: "sufficient",
        resumeEvidenceIds: ["resume:structured"],
      }],
      decision: {
        action: "ask",
        category: "technical_depth",
        intent: "follow_up",
        evidenceIds: ["resume:structured"],
        coverageTarget: "验证项目中的一致性设计",
        estimatedInformationGain: "high",
      },
    };
    const proposalHash = hashTurnProposalPrefix(proposal);
    await repository.authorizeProposal({
      runId: run.id,
      lease,
      attemptId,
      logicalMessageId,
      proposal,
      proposalHash,
      checkpoint: {
        turnCount: 1,
        toolCallCount: 1,
        lastEventSequence: 0,
        progressHash: "authorized",
        activeSkillNames: [],
      },
    });
    await repository.markResponseStarted({
      runId: run.id,
      lease,
      attemptId,
      logicalMessageId,
      proposalHash,
    });
    await repository.saveCheckpoint(run.id, {
      turnCount: 1,
      toolCallCount: 1,
      lastEventSequence: 0,
      progressHash: "committing",
      activeSkillNames: [],
      phase: "committing",
    }, lease);
    const commitInput = {
      runId: run.id,
      interviewId,
      toolCallId: "submit-atomic",
      lease,
      logicalMessageId,
      attemptId,
      answerMessageId: answerMessage.id,
      proposal,
      proposalHash,
      responseText: "你在项目中如何验证租约失效后的数据一致性？",
      language: "zh" as const,
    };
    const otherRun = await repository.createRun({
      interviewId,
      idempotencyKey: "other-answer-run",
    });
    await db.update(interviewMessages).set({ runId: otherRun.id })
      .where(eq(interviewMessages.id, answerMessage.id));
    await assert.rejects(repository.commitTurnOutcome(commitInput), /does not belong/i);
    const [wrongRunAssessments, wrongRunMessages, wrongRunQuestions, wrongRunCommits, wrongRunEvents] = await Promise.all([
      db.select().from(interviewAnswerAssessments)
        .where(eq(interviewAnswerAssessments.interviewId, interviewId)),
      db.select().from(interviewMessages)
        .where(eq(interviewMessages.interviewId, interviewId)),
      db.select().from(interviewQuestions)
        .where(eq(interviewQuestions.interviewId, interviewId)),
      db.select().from(interviewAgentToolCommits)
        .where(eq(interviewAgentToolCommits.runId, run.id)),
      db.select().from(interviewAgentEvents).where(and(
        eq(interviewAgentEvents.runId, run.id),
        eq(interviewAgentEvents.type, "message_committed"),
      )),
    ]);
    assert.equal(wrongRunAssessments.length, 0);
    assert.equal(wrongRunMessages.length, 1);
    assert.equal(wrongRunQuestions.length, 1);
    assert.equal(wrongRunCommits.length, 0);
    assert.equal(wrongRunEvents.length, 0);
    await db.update(interviewMessages).set({ runId: run.id })
      .where(eq(interviewMessages.id, answerMessage.id));
    const [first, replay] = await Promise.all([
      repository.commitTurnOutcome(commitInput),
      repository.commitTurnOutcome(commitInput),
    ]);
    assert.deepEqual(replay, first);
    assert.equal(first.messageId, logicalMessageId);

    const [assessments, messages, questions, commits, events, persistedRun] = await Promise.all([
      db.select().from(interviewAnswerAssessments)
        .where(eq(interviewAnswerAssessments.interviewId, interviewId)),
      db.select().from(interviewMessages)
        .where(eq(interviewMessages.interviewId, interviewId)),
      db.select().from(interviewQuestions)
        .where(eq(interviewQuestions.interviewId, interviewId)),
      db.select().from(interviewAgentToolCommits)
        .where(and(
          eq(interviewAgentToolCommits.runId, run.id),
          eq(interviewAgentToolCommits.toolName, "submit_interview_turn"),
        )),
      db.select().from(interviewAgentEvents).where(and(
        eq(interviewAgentEvents.runId, run.id),
        eq(interviewAgentEvents.type, "message_committed"),
      )),
      db.select().from(interviewAgentRuns).where(eq(interviewAgentRuns.id, run.id)),
    ]);
    assert.equal(assessments.length, 1);
    assert.equal(messages.length, 2);
    assert.equal(questions.length, 2);
    assert.equal(commits.length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].attemptId, attemptId);
    assert.equal(events[0].logicalMessageId, logicalMessageId);
    assert.equal(persistedRun[0].phase, "acting");
    assert.ok(persistedRun[0].proposalAuthorizedAt);
    assert.ok(persistedRun[0].responseStartedAt);
    const [technicalAggregate] = await db.select().from(interviewCoverage).where(and(
      eq(interviewCoverage.interviewId, interviewId),
      eq(interviewCoverage.category, "technical_depth"),
      eq(interviewCoverage.topic, "__category__"),
    ));
    assert.equal(technicalAggregate.questionCount, 2);
    assert.equal(technicalAggregate.status, "partial");

    await db.update(interviewCoverage).set({
      questionCount: 3,
      status: "exhausted",
    }).where(and(
      eq(interviewCoverage.interviewId, interviewId),
      eq(interviewCoverage.category, "technical_depth"),
      eq(interviewCoverage.topic, "__category__"),
    ));
    const secondAttemptId = "attempt-category-limit";
    const secondLogicalMessageId = randomUUID();
    const limitedProposal: TurnProposalPrefix = {
      assessment: null,
      coverageChanges: [],
      decision: {
        action: "ask",
        category: "technical_depth",
        intent: "new_topic",
        evidenceIds: ["resume:structured"],
        coverageTarget: "验证新的技术主题",
        estimatedInformationGain: "medium",
      },
    };
    const limitedHash = hashTurnProposalPrefix(limitedProposal);
    await repository.startAttempt(run.id, {
      model: "test-model",
      attemptId: secondAttemptId,
      attemptNumber: 2,
      provisionalMessageId: secondLogicalMessageId,
      now: new Date(),
    }, lease);
    await assert.rejects(
      repository.commitTurnOutcome(commitInput),
      /attempt is stale/i,
    );
    await assert.rejects(repository.authorizeProposal({
      runId: run.id,
      lease,
      attemptId,
      logicalMessageId,
      proposal,
      proposalHash,
      checkpoint: {
        turnCount: 1,
        toolCallCount: 1,
        lastEventSequence: first.committedEventSequence,
        progressHash: "stale-attempt",
        activeSkillNames: [],
      },
    }), /attempt is stale/i);
    await repository.authorizeProposal({
      runId: run.id,
      lease,
      attemptId: secondAttemptId,
      logicalMessageId: secondLogicalMessageId,
      proposal: limitedProposal,
      proposalHash: limitedHash,
      checkpoint: {
        turnCount: 2,
        toolCallCount: 2,
        lastEventSequence: first.committedEventSequence,
        progressHash: "category-limit",
        activeSkillNames: [],
      },
    });
    await repository.markResponseStarted({
      runId: run.id,
      lease,
      attemptId: secondAttemptId,
      logicalMessageId: secondLogicalMessageId,
      proposalHash: limitedHash,
    });
    await repository.saveCheckpoint(run.id, {
      turnCount: 2,
      toolCallCount: 2,
      lastEventSequence: first.committedEventSequence,
      progressHash: "category-limit:committing",
      activeSkillNames: [],
      phase: "committing",
    }, lease);
    await assert.rejects(repository.commitTurnOutcome({
      runId: run.id,
      interviewId,
      toolCallId: "submit-language-mismatch",
      lease,
      logicalMessageId: secondLogicalMessageId,
      attemptId: secondAttemptId,
      answerMessageId: null,
      proposal: limitedProposal,
      proposalHash: limitedHash,
      responseText: "请说明另一个技术主题？",
      language: "en",
    }), /language/i);
    await assert.rejects(repository.commitTurnOutcome({
      runId: run.id,
      interviewId,
      toolCallId: "submit-category-limit",
      lease,
      logicalMessageId: secondLogicalMessageId,
      attemptId: secondAttemptId,
      answerMessageId: null,
      proposal: limitedProposal,
      proposalHash: limitedHash,
      responseText: "请说明另一个技术主题？",
      language: "zh",
    }), /CATEGORY_LIMIT/);

    const [afterAssessments, afterMessages, afterQuestions, afterCommits, afterEvents] = await Promise.all([
      db.select().from(interviewAnswerAssessments)
        .where(eq(interviewAnswerAssessments.interviewId, interviewId)),
      db.select().from(interviewMessages)
        .where(eq(interviewMessages.interviewId, interviewId)),
      db.select().from(interviewQuestions)
        .where(eq(interviewQuestions.interviewId, interviewId)),
      db.select().from(interviewAgentToolCommits)
        .where(and(
          eq(interviewAgentToolCommits.runId, run.id),
          eq(interviewAgentToolCommits.toolName, "submit_interview_turn"),
        )),
      db.select().from(interviewAgentEvents).where(and(
        eq(interviewAgentEvents.runId, run.id),
        eq(interviewAgentEvents.type, "message_committed"),
      )),
    ]);
    assert.equal(afterAssessments.length, assessments.length);
    assert.equal(afterMessages.length, messages.length);
    assert.equal(afterQuestions.length, questions.length);
    assert.equal(afterCommits.length, commits.length);
    assert.equal(afterEvents.length, events.length);
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

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the durable Agent event notification");
}

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
