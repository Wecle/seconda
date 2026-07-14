import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, asc, eq, inArray } from "drizzle-orm";
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
  runAgentRuntimeCutoverCommand,
  type AgentRuntimeCutoverStore,
} from "./agent-runtime-cutover";

type FixtureTerminalEvent = {
  sequence: number;
  type: "run_completed" | "run_failed";
  visibility: "public" | "internal";
};

type CutoverRun = {
  id: string;
  assistantMessage: boolean;
  leaseGeneration: number;
  streamMode: string | null;
  checkpoint: unknown;
  authoritative: boolean;
  pendingSchedule: boolean;
  terminalEvents: FixtureTerminalEvent[];
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
    terminalEvents: overrides.terminalEvents ?? [],
  };
}

function cutoverFixture(
  initial: CutoverRun[],
  missingOpeningRuns: string[] = [],
  executionTerminals: Record<string, FixtureTerminalEvent["type"]> = {},
) {
  const rows = new Map(initial.map((run) => [run.id, structuredClone(run)]));
  const executedRuns: string[] = [];
  let pendingOpeningRuns = [...missingOpeningRuns];
  const store: AgentRuntimeCutoverStore = {
    async normalizePublicTerminalEvents() {
      for (const run of rows.values()) {
        const publicTerminals = run.terminalEvents
          .filter((event) => event.visibility === "public")
          .toSorted((left, right) => right.sequence - left.sequence);
        for (const terminal of publicTerminals.slice(1)) {
          terminal.visibility = "internal";
        }
      }
    },
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
        if (run.pendingSchedule) {
          for (const terminal of run.terminalEvents) {
            if (terminal.visibility === "public") terminal.visibility = "internal";
          }
        }
        return run.pendingSchedule ? "resume" : "skipped";
      }
      run.streamMode = "durable_provisional";
      run.leaseGeneration += 1;
      run.checkpoint = null;
      if (!run.assistantMessage && !run.authoritative) return "skipped";
      if (run.assistantMessage) {
        const authoritativeTerminal = run.terminalEvents
          .filter((event) => event.visibility === "public")
          .toSorted((left, right) => right.sequence - left.sequence)[0];
        if (authoritativeTerminal) authoritativeTerminal.type = "run_completed";
        else {
          run.terminalEvents.push({
            sequence: Math.max(0, ...run.terminalEvents.map((event) => event.sequence)) + 1,
            type: "run_completed",
            visibility: "public",
          });
        }
        return "completed";
      }
      for (const terminal of run.terminalEvents) {
        if (terminal.visibility === "public") terminal.visibility = "internal";
      }
      run.pendingSchedule = true;
      return "resume";
    },
  };
  return {
    store,
    executeRun: async (runId: string) => {
      executedRuns.push(runId);
      const run = rows.get(runId)!;
      run.pendingSchedule = false;
      const terminalType = executionTerminals[runId];
      if (terminalType) {
        run.terminalEvents.push({
          sequence: Math.max(0, ...run.terminalEvents.map((event) => event.sequence)) + 1,
          type: terminalType,
          visibility: "public",
        });
      }
    },
    executedRuns,
    run: (runId: string) => rows.get(runId)!,
  };
}

test("normalizes duplicate public terminals before reconciling active runs", async () => {
  const fixture = cutoverFixture([
    runningRun({
      id: "duplicate-terminal",
      streamMode: "durable_provisional",
      terminalEvents: [
        { sequence: 2, type: "run_failed", visibility: "public" },
        { sequence: 5, type: "run_failed", visibility: "public" },
      ],
    }),
  ]);

  await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun);

  assert.deepEqual(fixture.run("duplicate-terminal").terminalEvents, [
    { sequence: 2, type: "run_failed", visibility: "internal" },
    { sequence: 5, type: "run_failed", visibility: "public" },
  ]);
});

test("archives a legacy terminal before a resumed run publishes its authoritative terminal", async () => {
  const fixture = cutoverFixture([
    runningRun({
      id: "retry-failure",
      terminalEvents: [{ sequence: 3, type: "run_failed", visibility: "public" }],
    }),
    runningRun({
      id: "retry-success",
      terminalEvents: [{ sequence: 7, type: "run_failed", visibility: "public" }],
    }),
  ], [], {
    "retry-failure": "run_failed",
    "retry-success": "run_completed",
  });

  await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun);

  assert.deepEqual(
    fixture.run("retry-failure").terminalEvents.filter((event) => event.visibility === "public"),
    [{ sequence: 4, type: "run_failed", visibility: "public" }],
  );
  assert.deepEqual(
    fixture.run("retry-success").terminalEvents.filter((event) => event.visibility === "public"),
    [{ sequence: 8, type: "run_completed", visibility: "public" }],
  );
});

test("cutover command closes its database dependency after success", async () => {
  const fixture = cutoverFixture([]);
  const output: string[] = [];
  let closeCount = 0;

  const result = await runAgentRuntimeCutoverCommand({
    store: fixture.store,
    executeRun: fixture.executeRun,
    close: async () => { closeCount += 1; },
    writeOutput: (line) => { output.push(line); },
  });

  assert.deepEqual(result, { completed: [], resumed: [] });
  assert.deepEqual(output, ['{"completed":[],"resumed":[]}\n']);
  assert.equal(closeCount, 1);
});

test("cutover command closes its database dependency after reconciliation failure", async () => {
  let closeCount = 0;
  const failure = new Error("fixture cutover failure");
  const store: AgentRuntimeCutoverStore = {
    async normalizePublicTerminalEvents() {},
    async prepareMissingOpeningRuns() { return []; },
    async listCandidateRunIds() { throw failure; },
    async reconcileRun() { return "skipped"; },
  };

  await assert.rejects(
    runAgentRuntimeCutoverCommand({
      store,
      executeRun: async () => {},
      close: async () => { closeCount += 1; },
      writeOutput: () => { throw new Error("failure path must not print success"); },
    }),
    failure,
  );
  assert.equal(closeCount, 1);
});

test("cutover command drains deferred completion work before output and close", async () => {
  const fixture = cutoverFixture([]);
  const order: string[] = [];

  await runAgentRuntimeCutoverCommand({
    store: fixture.store,
    executeRun: fixture.executeRun,
    drain: async () => { order.push("drain"); },
    writeOutput: () => { order.push("output"); },
    close: async () => { order.push("close"); },
  });

  assert.deepEqual(order, ["drain", "output", "close"]);
});

test("cutover command preserves reconciliation and drain failures", async () => {
  const primary = new Error("reconciliation failed");
  const cleanup = new Error("drain failed");
  const store: AgentRuntimeCutoverStore = {
    async normalizePublicTerminalEvents() { throw primary; },
    async prepareMissingOpeningRuns() { return []; },
    async listCandidateRunIds() { return []; },
    async reconcileRun() { return "skipped"; },
  };

  await assert.rejects(runAgentRuntimeCutoverCommand({
    store,
    executeRun: async () => {},
    drain: async () => { throw cleanup; },
    close: async () => {},
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, cleanup]);
    return true;
  });
});

test("cutover command preserves reconciliation and close failures", async () => {
  const primary = new Error("reconciliation failed");
  const cleanup = new Error("close failed");
  const store: AgentRuntimeCutoverStore = {
    async normalizePublicTerminalEvents() { throw primary; },
    async prepareMissingOpeningRuns() { return []; },
    async listCandidateRunIds() { return []; },
    async reconcileRun() { return "skipped"; },
  };

  await assert.rejects(runAgentRuntimeCutoverCommand({
    store,
    executeRun: async () => {},
    close: async () => { throw cleanup; },
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, cleanup]);
    return true;
  });
});

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

    const durableRetryInterviewId = await createInterview();
    const durableRetryRepository = createDrizzleInterviewAgentRepository(database);
    const durableRetryRun = await durableRetryRepository.createRun({
      interviewId: durableRetryInterviewId,
      idempotencyKey: "durable-retry-with-old-terminal",
    });
    await durableRetryRepository.saveRunTrigger(durableRetryRun.id, {
      mode: "opening",
      instruction: "continue durable retry",
    });
    await database.update(interviewAgentRuns).set({
      lastEventSequence: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(eq(interviewAgentRuns.id, durableRetryRun.id));
    await database.insert(interviewAgentEvents).values({
      runId: durableRetryRun.id,
      sequence: 1,
      visibility: "public",
      type: "run_failed",
      payload: {
        runId: durableRetryRun.id,
        exitReason: "aborted_streaming",
        retryable: true,
        userMessage: "old durable failure",
      },
    });
    const durableRetryCutover = createDrizzleAgentRuntimeCutoverStore(database, {
      interviewIds: [durableRetryInterviewId],
    });
    let terminalVisibilityBeforeExecute: string | null = null;
    assert.deepEqual(
      await reconcileAgentRuntimeCutover(durableRetryCutover, async (runId) => {
        assert.equal(runId, durableRetryRun.id);
        const [terminal] = await database.select({
          visibility: interviewAgentEvents.visibility,
        }).from(interviewAgentEvents).where(and(
          eq(interviewAgentEvents.runId, runId),
          eq(interviewAgentEvents.sequence, 1),
        ));
        terminalVisibilityBeforeExecute = terminal.visibility;
        await database.update(interviewAgentRuns).set({
          leaseOwner: "scheduled-durable-retry",
          leaseExpiresAt: new Date(Date.now() + 60_000),
        }).where(eq(interviewAgentRuns.id, runId));
      }),
      { completed: [], resumed: [durableRetryRun.id] },
    );
    assert.equal(terminalVisibilityBeforeExecute, "internal");

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
      lastEventSequence: 2,
      completedAt: new Date(),
    }).where(eq(interviewAgentRuns.id, committedRun.id));
    await database.insert(interviewAgentEvents).values([1, 2].map((sequence) => ({
      runId: committedRun.id,
      sequence,
      visibility: "public",
      type: "run_failed",
      payload: {
        runId: committedRun.id,
        exitReason: "aborted_streaming",
        retryable: true,
        userMessage: "流式响应中断，请重试。",
      },
    })));

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
    await cutover.normalizePublicTerminalEvents();
    assert.deepEqual(
      await database.select({
        sequence: interviewAgentEvents.sequence,
        visibility: interviewAgentEvents.visibility,
      }).from(interviewAgentEvents)
        .where(and(
          eq(interviewAgentEvents.runId, committedRun.id),
          inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
        ))
        .orderBy(asc(interviewAgentEvents.sequence)),
      [
        { sequence: 1, visibility: "internal" },
        { sequence: 2, visibility: "public" },
      ],
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
    const committedTerminal = await database.select({
      sequence: interviewAgentEvents.sequence,
      type: interviewAgentEvents.type,
      visibility: interviewAgentEvents.visibility,
    })
      .from(interviewAgentEvents)
      .where(and(
        eq(interviewAgentEvents.runId, committedRun.id),
        inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
      ))
      .orderBy(asc(interviewAgentEvents.sequence));
    assert.deepEqual(committedTerminal, [
      { sequence: 1, type: "run_failed", visibility: "internal" },
      { sequence: 2, type: "run_completed", visibility: "public" },
    ]);

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

    const verifyLegacyRetryTerminal = async (
      terminalExitReason: "completed" | "aborted_streaming",
    ) => {
      const retryInterviewId = await createInterview();
      const retryRun = await repository.createRun({
        interviewId: retryInterviewId,
        idempotencyKey: `legacy-retry-${terminalExitReason}`,
      });
      await repository.saveRunTrigger(retryRun.id, {
        mode: "opening",
        instruction: "continue",
      });
      await database.update(interviewAgentRuns).set({
        status: "failed",
        streamMode: "non_streaming",
        exitReason: "aborted_streaming",
        lastEventSequence: 1,
        completedAt: new Date(),
      }).where(eq(interviewAgentRuns.id, retryRun.id));
      await database.insert(interviewAgentEvents).values({
        runId: retryRun.id,
        sequence: 1,
        visibility: "public",
        type: "run_failed",
        payload: {
          runId: retryRun.id,
          exitReason: "aborted_streaming",
          retryable: true,
          userMessage: "流式响应中断，请重试。",
        },
      });

      const retryCutover = createDrizzleAgentRuntimeCutoverStore(database, {
        interviewIds: [retryInterviewId],
      });
      assert.equal(await retryCutover.reconcileRun(retryRun.id), "resume");
      const [archivedTerminal] = await database.select({
        visibility: interviewAgentEvents.visibility,
      }).from(interviewAgentEvents).where(and(
        eq(interviewAgentEvents.runId, retryRun.id),
        eq(interviewAgentEvents.sequence, 1),
      ));
      assert.equal(archivedTerminal.visibility, "internal");

      const owner = `retry-worker-${terminalExitReason}`;
      const claim = await repository.claimRun(retryRun.id, owner, new Date(), 60_000);
      assert.equal(claim.claimed, true);
      assert.ok(claim.run);
      await repository.terminateRun(retryRun.id, {
        exitReason: terminalExitReason,
        ...(terminalExitReason === "completed"
          ? {}
          : { error: new Error("fixture retry failure") }),
      }, {
        owner,
        generation: claim.run.leaseGeneration,
      });

      const terminals = await database.select({
        sequence: interviewAgentEvents.sequence,
        type: interviewAgentEvents.type,
        visibility: interviewAgentEvents.visibility,
      }).from(interviewAgentEvents).where(and(
        eq(interviewAgentEvents.runId, retryRun.id),
        inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
      )).orderBy(asc(interviewAgentEvents.sequence));
      assert.deepEqual(terminals, [
        { sequence: 1, type: "run_failed", visibility: "internal" },
        {
          sequence: 2,
          type: terminalExitReason === "completed" ? "run_completed" : "run_failed",
          visibility: "public",
        },
      ]);
    };

    await verifyLegacyRetryTerminal("aborted_streaming");
    await verifyLegacyRetryTerminal("completed");

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
