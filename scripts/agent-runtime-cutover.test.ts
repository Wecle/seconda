import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import {
  interviewAgentEvents,
  interviewAgentRuns,
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "../lib/db/schema";
import { createDrizzleAgentInterviewStore } from "../lib/interview/agent/drizzle-store";
import { createDrizzleInterviewAgentRepository } from "../lib/interview/agent/repository";
import {
  createDrizzleAgentRuntimeCutoverStore,
  reconcileAgentRuntimeCutover,
  type AgentRuntimeCutoverStore,
} from "./agent-runtime-cutover";

type CutoverRun = {
  id: string;
  assistantMessage: boolean;
  leaseGeneration: number;
  streamMode: string | null;
  checkpoint: unknown;
  authoritative: boolean;
  pendingSchedule: boolean;
};

function runningRun(
  overrides: Partial<CutoverRun> & Pick<CutoverRun, "id">,
): CutoverRun {
  return {
    id: overrides.id,
    assistantMessage: overrides.assistantMessage ?? false,
    leaseGeneration: overrides.leaseGeneration ?? 0,
    streamMode: overrides.streamMode ?? null,
    checkpoint: overrides.checkpoint ?? { phase: "reasoning" },
    authoritative: overrides.authoritative ?? true,
    pendingSchedule: overrides.pendingSchedule ?? false,
  };
}

function cutoverFixture(initial: CutoverRun[], missingOpeningRuns: string[] = []) {
  const rows = new Map(initial.map((run) => [run.id, structuredClone(run)]));
  const executedRuns: string[] = [];
  let pendingOpeningRuns = [...missingOpeningRuns];
  const store: AgentRuntimeCutoverStore = {
    async prepareMissingOpeningRuns() {
      const created = pendingOpeningRuns;
      pendingOpeningRuns = [];
      for (const runId of created) {
        rows.set(runId, runningRun({
          id: runId,
          streamMode: "durable_provisional",
          pendingSchedule: true,
        }));
      }
      return created;
    },
    async listCandidateRunIds() {
      return [...rows.keys()];
    },
    async reconcileRun(runId) {
      const run = rows.get(runId)!;
      if (run.streamMode === "durable_provisional") {
        return run.pendingSchedule ? "resume" : "skipped";
      }
      run.streamMode = "durable_provisional";
      run.leaseGeneration += 1;
      run.checkpoint = null;
      if (!run.assistantMessage && !run.authoritative) return "skipped";
      if (run.assistantMessage) return "completed";
      run.pendingSchedule = true;
      return "resume";
    },
  };
  return {
    store,
    executeRun: async (runId: string) => {
      executedRuns.push(runId);
      rows.get(runId)!.pendingSchedule = false;
    },
    executedRuns,
    run: (runId: string) => rows.get(runId)!,
  };
}

test("fences unfinished runs and resumes only uncommitted work", async () => {
  const fixture = cutoverFixture([
    runningRun({ id: "committed", assistantMessage: true, leaseGeneration: 2 }),
    runningRun({ id: "unfinished", assistantMessage: false, leaseGeneration: 4 }),
  ]);
  const result = await reconcileAgentRuntimeCutover(
    fixture.store,
    fixture.executeRun,
  );
  assert.deepEqual(result, {
    completed: ["committed"],
    resumed: ["unfinished"],
  });
  assert.equal(fixture.run("unfinished").leaseGeneration, 5);
  assert.equal(fixture.run("unfinished").checkpoint, null);
  assert.deepEqual(fixture.executedRuns, ["unfinished"]);
});

test("starts the latest opening loop for an active interview without a run", async () => {
  const fixture = cutoverFixture([], ["opening-run"]);
  assert.deepEqual(
    await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun),
    { completed: [], resumed: ["opening-run"] },
  );
  assert.deepEqual(fixture.executedRuns, ["opening-run"]);
  assert.deepEqual(
    await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun),
    { completed: [], resumed: [] },
  );
});

test("is idempotent after the first cutover", async () => {
  const fixture = cutoverFixture([
    runningRun({
      id: "run",
      assistantMessage: false,
      streamMode: "durable_provisional",
    }),
  ]);
  await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun);
  assert.deepEqual(
    await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun),
    { completed: [], resumed: [] },
  );
});

test("retries a durable unfinished run after crashing before execution", async () => {
  const fixture = cutoverFixture([runningRun({ id: "unfinished" })]);
  assert.equal(await fixture.store.reconcileRun("unfinished"), "resume");

  assert.deepEqual(
    await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun),
    { completed: [], resumed: ["unfinished"] },
  );
  assert.deepEqual(fixture.executedRuns, ["unfinished"]);
});

test("retries a durable opening after crashing before execution", async () => {
  const fixture = cutoverFixture([], ["opening-run"]);
  assert.deepEqual(await fixture.store.prepareMissingOpeningRuns(), ["opening-run"]);

  assert.deepEqual(
    await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun),
    { completed: [], resumed: ["opening-run"] },
  );
  assert.deepEqual(fixture.executedRuns, ["opening-run"]);
});

test("resumes only the authoritative unfinished run", async () => {
  const fixture = cutoverFixture([
    runningRun({ id: "older", authoritative: false }),
    runningRun({ id: "latest" }),
  ]);
  assert.deepEqual(
    await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun),
    { completed: [], resumed: ["latest"] },
  );
  assert.equal(fixture.run("older").streamMode, "durable_provisional");
  assert.deepEqual(fixture.executedRuns, ["latest"]);
});

test("PostgreSQL cutover creates openings, fences workers and reconciles committed runs", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  const resumeId = randomUUID();
  const versionId = randomUUID();
  const interviewIds: string[] = [];
  try {
    await database.insert(users).values({
      id: userId,
      email: `${userId}@cutover.test`,
    });
    await database.insert(resumes).values({
      id: resumeId,
      userId,
      title: "Cutover resume",
    });
    await database.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      originalFilename: "resume.pdf",
      storedPath: `/tmp/${versionId}.pdf`,
      extractedText: "PostgreSQL TypeScript reliability",
      parsedJson: {
        name: "Candidate",
        title: "Engineer",
        skills: ["PostgreSQL", "TypeScript"],
        experience: [],
        education: [],
        projects: [],
        summary: "Reliability engineer",
      },
      parseStatus: "parsed",
    });
    const interviewStore = createDrizzleAgentInterviewStore(database);
    const createInterview = async () => {
      const created = await interviewStore.createInterview({
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
      interviewIds.push(created.interviewId);
      return created.interviewId;
    };

    const openingInterviewId = await createInterview();
    const openingCutover = createDrizzleAgentRuntimeCutoverStore(database, {
      interviewIds: [openingInterviewId],
    });
    const openingRuns = await openingCutover.prepareMissingOpeningRuns();
    assert.equal(openingRuns.length, 1);
    assert.deepEqual(await openingCutover.prepareMissingOpeningRuns(), []);
    const [openingRun] = await database.select({
      streamMode: interviewAgentRuns.streamMode,
      trigger: interviewAgentRuns.triggerJson,
    }).from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, openingRuns[0]));
    assert.equal(openingRun.streamMode, "durable_provisional");
    assert.equal((openingRun.trigger as { mode?: string }).mode, "opening");
    const coverage = await database.select({ id: interviewCoverage.id })
      .from(interviewCoverage)
      .where(eq(interviewCoverage.interviewId, openingInterviewId));
    assert.equal(coverage.length, 9);
    const openingResumed: string[] = [];
    assert.deepEqual(
      await reconcileAgentRuntimeCutover(openingCutover, async (runId) => {
        openingResumed.push(runId);
        await database.update(interviewAgentRuns).set({
          leaseOwner: "scheduled-opening",
          leaseExpiresAt: new Date(Date.now() + 60_000),
        }).where(eq(interviewAgentRuns.id, runId));
      }),
      { completed: [], resumed: [openingRuns[0]] },
    );
    assert.deepEqual(openingResumed, [openingRuns[0]]);
    assert.deepEqual(
      await reconcileAgentRuntimeCutover(openingCutover, async () => {}),
      { completed: [], resumed: [] },
    );

    const acceptedInterviewId = await createInterview();
    const [acceptedQuestion] = await database.insert(interviewQuestions).values({
      interviewId: acceptedInterviewId,
      questionIndex: 1,
      questionType: "introduction",
      question: "请做自我介绍。",
    }).returning({ id: interviewQuestions.id });
    const accepted = await interviewStore.acceptCandidateMessage({
      interviewId: acceptedInterviewId,
      content: "我是候选人。",
      idempotencyKey: randomUUID(),
      runIdempotencyKey: randomUUID(),
      trigger: { mode: "answer", instruction: "continue" },
    });
    assert.ok(acceptedQuestion.id);
    const [acceptedRun] = await database.select({
      streamMode: interviewAgentRuns.streamMode,
    }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, accepted.runId));
    assert.equal(acceptedRun.streamMode, "durable_provisional");

    const reconciliationInterviewId = await createInterview();
    const repository = createDrizzleInterviewAgentRepository(database);
    const committedRun = await repository.createRun({
      interviewId: reconciliationInterviewId,
      idempotencyKey: "committed",
    });
    const [nativeRun] = await database.select({
      streamMode: interviewAgentRuns.streamMode,
    }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, committedRun.id));
    assert.equal(nativeRun.streamMode, "durable_provisional");
    await database.update(interviewAgentRuns).set({
      streamMode: "non_streaming",
    }).where(eq(interviewAgentRuns.id, committedRun.id));
    await repository.saveRunTrigger(committedRun.id, {
      mode: "opening",
      instruction: "continue",
    });
    await repository.appendMessage({
      interviewId: reconciliationInterviewId,
      runId: committedRun.id,
      role: "assistant",
      kind: "opening",
      content: "请先做自我介绍。",
    });
    await database.update(interviewAgentRuns).set({
      status: "failed",
      exitReason: "aborted_streaming",
      lastEventSequence: 1,
      completedAt: new Date(),
    }).where(eq(interviewAgentRuns.id, committedRun.id));
    await database.insert(interviewAgentEvents).values({
      runId: committedRun.id,
      sequence: 1,
      visibility: "public",
      type: "run_failed",
      payload: {
        runId: committedRun.id,
        exitReason: "aborted_streaming",
        retryable: true,
        userMessage: "流式响应中断，请重试。",
      },
    });

    const unfinishedRun = await repository.createRun({
      interviewId: reconciliationInterviewId,
      idempotencyKey: "unfinished",
    });
    await database.update(interviewAgentRuns).set({
      streamMode: "non_streaming",
    }).where(eq(interviewAgentRuns.id, unfinishedRun.id));
    await repository.saveRunTrigger(unfinishedRun.id, {
      mode: "answer",
      instruction: "continue",
    });
    await repository.startAttempt(unfinishedRun.id, {
      model: "test-model",
      attemptId: "attempt-before-cutover",
      attemptNumber: 1,
      provisionalMessageId: "message-before-cutover",
      now: new Date(),
    });
    await repository.appendEvent(unfinishedRun.id, {
      type: "response_started",
      visibility: "public",
      attemptId: "attempt-before-cutover",
      logicalMessageId: "message-before-cutover",
      payload: {
        runId: unfinishedRun.id,
        attemptId: "attempt-before-cutover",
        logicalMessageId: "message-before-cutover",
      },
    });
    await database.update(interviewAgentRuns).set({
      leaseOwner: "old-worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseGeneration: 4,
      checkpointJson: { phase: "responding" },
      createdAt: new Date("2026-01-01T00:00:02.000Z"),
    }).where(eq(interviewAgentRuns.id, unfinishedRun.id));
    await database.update(interviewAgentRuns).set({
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    }).where(eq(interviewAgentRuns.id, committedRun.id));

    const authoritativeRun = await repository.createRun({
      interviewId: reconciliationInterviewId,
      idempotencyKey: "authoritative-unfinished",
    });
    await database.update(interviewAgentRuns).set({
      streamMode: "non_streaming",
    }).where(eq(interviewAgentRuns.id, authoritativeRun.id));
    await repository.saveRunTrigger(authoritativeRun.id, {
      mode: "answer",
      instruction: "continue latest answer",
    });
    await database.update(interviewAgentRuns).set({
      leaseOwner: "latest-old-worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseGeneration: 7,
      checkpointJson: { phase: "reasoning" },
      createdAt: new Date("2026-01-01T00:00:03.000Z"),
    }).where(eq(interviewAgentRuns.id, authoritativeRun.id));

    const cutover = createDrizzleAgentRuntimeCutoverStore(database, {
      interviewIds: [reconciliationInterviewId],
    });
    assert.deepEqual(
      (await cutover.listCandidateRunIds()).toSorted(),
      [committedRun.id, unfinishedRun.id, authoritativeRun.id].toSorted(),
    );
    assert.equal(await cutover.reconcileRun(committedRun.id), "completed");
    assert.equal(await cutover.reconcileRun(unfinishedRun.id), "skipped");
    assert.equal(await cutover.reconcileRun(unfinishedRun.id), "skipped");
    assert.equal(await cutover.reconcileRun(authoritativeRun.id), "resume");

    const [committed] = await database.select({
      status: interviewAgentRuns.status,
      streamMode: interviewAgentRuns.streamMode,
      leaseGeneration: interviewAgentRuns.leaseGeneration,
    }).from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, committedRun.id));
    assert.deepEqual(committed, {
      status: "completed",
      streamMode: "durable_provisional",
      leaseGeneration: 1,
    });
    const committedTerminal = await database.select({ type: interviewAgentEvents.type })
      .from(interviewAgentEvents)
      .where(and(
        eq(interviewAgentEvents.runId, committedRun.id),
        eq(interviewAgentEvents.type, "run_completed"),
      ));
    assert.equal(committedTerminal.length, 1);

    const [unfinished] = await database.select({
      status: interviewAgentRuns.status,
      phase: interviewAgentRuns.phase,
      streamMode: interviewAgentRuns.streamMode,
      leaseOwner: interviewAgentRuns.leaseOwner,
      leaseGeneration: interviewAgentRuns.leaseGeneration,
      attemptId: interviewAgentRuns.attemptId,
      attemptNumber: interviewAgentRuns.attemptNumber,
      provisionalMessageId: interviewAgentRuns.provisionalMessageId,
      checkpoint: interviewAgentRuns.checkpointJson,
    }).from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, unfinishedRun.id));
    assert.deepEqual(unfinished, {
      status: "failed",
      phase: "acting",
      streamMode: "durable_provisional",
      leaseOwner: null,
      leaseGeneration: 5,
      attemptId: null,
      attemptNumber: 1,
      provisionalMessageId: null,
      checkpoint: null,
    });
    const discarded = await database.select({
      type: interviewAgentEvents.type,
      visibility: interviewAgentEvents.visibility,
    }).from(interviewAgentEvents)
      .where(and(
        eq(interviewAgentEvents.runId, unfinishedRun.id),
        eq(interviewAgentEvents.type, "response_discarded"),
      ));
    assert.deepEqual(discarded, [{
      type: "response_discarded",
      visibility: "public",
    }]);
    const supersededTerminal = await database.select({
      type: interviewAgentEvents.type,
      visibility: interviewAgentEvents.visibility,
    }).from(interviewAgentEvents)
      .where(and(
        eq(interviewAgentEvents.runId, unfinishedRun.id),
        eq(interviewAgentEvents.type, "run_failed"),
      ));
    assert.deepEqual(supersededTerminal, [{
      type: "run_failed",
      visibility: "public",
    }]);

    const [authoritative] = await database.select({
      status: interviewAgentRuns.status,
      phase: interviewAgentRuns.phase,
      streamMode: interviewAgentRuns.streamMode,
      leaseOwner: interviewAgentRuns.leaseOwner,
      leaseGeneration: interviewAgentRuns.leaseGeneration,
      attemptNumber: interviewAgentRuns.attemptNumber,
      checkpoint: interviewAgentRuns.checkpointJson,
    }).from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, authoritativeRun.id));
    assert.deepEqual(authoritative, {
      status: "running",
      phase: "accepted",
      streamMode: "durable_provisional",
      leaseOwner: null,
      leaseGeneration: 8,
      attemptNumber: 1,
      checkpoint: null,
    });
    const recoveredAfterCrash: string[] = [];
    assert.deepEqual(
      await reconcileAgentRuntimeCutover(cutover, async (runId) => {
        recoveredAfterCrash.push(runId);
        await database.update(interviewAgentRuns).set({
          leaseOwner: "scheduled-after-crash",
          leaseExpiresAt: new Date(Date.now() + 60_000),
        }).where(eq(interviewAgentRuns.id, runId));
      }),
      { completed: [], resumed: [authoritativeRun.id] },
    );
    assert.deepEqual(recoveredAfterCrash, [authoritativeRun.id]);
    assert.deepEqual(
      await reconcileAgentRuntimeCutover(cutover, async () => {}),
      { completed: [], resumed: [] },
    );

    const endingInterviewId = await createInterview();
    const endingRun = await repository.createRun({
      interviewId: endingInterviewId,
      idempotencyKey: "ending-race",
    });
    await repository.saveRunTrigger(endingRun.id, {
      mode: "opening",
      instruction: "continue",
    });
    await database.update(interviewAgentRuns).set({
      streamMode: "non_streaming",
    }).where(eq(interviewAgentRuns.id, endingRun.id));
    let releaseEnd!: () => void;
    const endCanCommit = new Promise<void>((resolve) => {
      releaseEnd = resolve;
    });
    let endLocked!: () => void;
    const endHasLock = new Promise<void>((resolve) => {
      endLocked = resolve;
    });
    const endingTransaction = client.begin(async (transaction) => {
      const transactionSql = transaction as unknown as typeof client;
      await transactionSql`SELECT pg_advisory_xact_lock(hashtext(${endingInterviewId}))`;
      await transactionSql`UPDATE interviews SET status = 'completing' WHERE id = ${endingInterviewId}`;
      await transactionSql`
        UPDATE interview_agent_runs
        SET status = 'failed',
            exit_reason = 'aborted_tools',
            lease_owner = NULL,
            lease_expires_at = NULL,
            lease_generation = lease_generation + 1
        WHERE id = ${endingRun.id}
      `;
      endLocked();
      await endCanCommit;
    });
    await endHasLock;
    const endingCutover = createDrizzleAgentRuntimeCutoverStore(database, {
      interviewIds: [endingInterviewId],
    });
    const reconcileDuringEnd = endingCutover.reconcileRun(endingRun.id);
    releaseEnd();
    await endingTransaction;
    assert.equal(await reconcileDuringEnd, "skipped");
    const [endedRun] = await database.select({
      status: interviewAgentRuns.status,
      streamMode: interviewAgentRuns.streamMode,
      leaseGeneration: interviewAgentRuns.leaseGeneration,
    }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, endingRun.id));
    assert.deepEqual(endedRun, {
      status: "failed",
      streamMode: "non_streaming",
      leaseGeneration: 1,
    });

    assert.equal(
      await database.$count(
        interviewMessages,
        eq(interviewMessages.runId, committedRun.id),
      ),
      1,
    );
  } finally {
    if (interviewIds.length > 0) {
      await database.delete(interviews)
        .where(inArray(interviews.id, interviewIds));
    }
    await database.delete(resumes).where(eq(resumes.id, resumeId));
    await database.delete(users).where(eq(users.id, userId));
    await client.end();
  }
});
