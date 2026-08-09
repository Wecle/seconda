import assert from "node:assert/strict";
import test from "node:test";
import { queryAIOperations, type Sql } from "./ai-operations";

type FixtureRows = Record<string, readonly Record<string, unknown>[]>;

function sqlFixture(fixtures: FixtureRows) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const sql = (<T extends readonly Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    const fixture = Object.entries(fixtures).find(([view]) => text.includes(view));
    return Promise.resolve((fixture?.[1] ?? []) as T);
  }) as Sql;
  return { sql, calls };
}

test("all starts every independent view query before awaiting results", async () => {
  const calls: string[] = [];
  const resolvers: Array<() => void> = [];
  const sql = (<T extends readonly Record<string, unknown>[]>(strings: TemplateStringsArray) => {
    calls.push(strings.join(" ").replace(/\s+/g, " "));
    return new Promise<T>((resolve) => {
      resolvers.push(() => resolve([] as unknown as T));
      if (resolvers.length === 8) queueMicrotask(() => resolvers.forEach((done) => done()));
    });
  }) as Sql;

  const query = queryAIOperations(sql, {
    command: "all",
    since: new Date("2026-08-02T12:00:00.000Z"),
    limit: 20,
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  assert.equal(calls.length, 8);
  await query;
});

test("maps numeric database values and preserves unknown aggregates", async () => {
  const { sql } = sqlFixture({
    'AS "taskRuns"': [{
      taskRuns: "2",
      attempts: "3",
      completedTasks: "1",
      failedTasks: "1",
      inputTokens: "120",
      outputTokens: "30",
      knownCostMicros: null,
    }],
  });

  const result = await queryAIOperations(sql, {
    command: "summary",
    since: new Date("2026-08-02T12:00:00.000Z"),
    limit: 20,
  });

  assert.deepEqual(result.sections.summary, {
    taskRuns: 2,
    attempts: 3,
    completedTasks: 1,
    failedTasks: 1,
    inputTokens: 120,
    outputTokens: 30,
    knownCostMicros: null,
  });
});

test("uses parameters and queries only operational views", async () => {
  const interviewId = "6c299bb0-99be-4a3f-977f-a06ef8d80bb7";
  const since = new Date("2026-08-02T12:00:00.000Z");
  const { sql, calls } = sqlFixture({ ai_interview_observability: [] });

  await queryAIOperations(sql, {
    command: "interview",
    since,
    limit: 37,
    interviewId,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /FROM ai_interview_observability/);
  assert.ok(calls[0].values.includes(interviewId));
  assert.ok(calls[0].values.some((value) => value instanceof Date));
  assert.ok(!calls[0].text.includes(interviewId));
  assert.ok(!calls[0].text.includes("ai_task_runs"));
  assert.ok(!calls[0].text.includes("ai_task_attempts"));
});

test("uses exact rolling timestamps for aggregate operational sections", async () => {
  const since = new Date("2026-08-02T12:34:56.000Z");
  const { sql, calls } = sqlFixture({});

  const result = await queryAIOperations(sql, {
    command: "all",
    since,
    limit: 20,
  });
  const untilMs = Date.parse(result.window.until);

  const aggregateCalls = calls.filter(({ text }) => text.includes("ai_task_operation_attempts"));
  assert.equal(aggregateCalls.length, 5);
  for (const call of aggregateCalls) {
    assert.doesNotMatch(call.text, /date_trunc/);
    assert.doesNotMatch(call.text, /attempt_number = 1/);
    assert.ok(call.values.includes(since));
    assert.ok(call.values.some((value) => value instanceof Date && value.getTime() === untilMs));
    assert.doesNotMatch(call.text, /(?:FROM|JOIN) ai_task_runs\b/);
    assert.doesNotMatch(call.text, /(?:FROM|JOIN) ai_task_attempts\b/);
  }
  assert.equal(aggregateCalls.filter(({ text }) =>
    text.includes("is_first_persisted_attempt = TRUE")).length, 2);
});

test("reads budget details from the privacy-safe budget view", async () => {
  const { sql } = sqlFixture({
    ai_budget_warnings: [{
      taskRunId: "bce8ead8-2f60-4522-bcc5-d6bf56606573",
      task: "interview.agent",
      budgetScope: "agent_run:run-1",
      budgetMode: "enforce",
      tokenLimit: "500000",
      usedTokens: "501000",
      rejected: true,
      startedAt: new Date("2026-08-03T10:00:00.000Z"),
    }],
  });

  const result = await queryAIOperations(sql, {
    command: "budgets",
    since: new Date("2026-08-02T12:00:00.000Z"),
    limit: 20,
  });

  assert.deepEqual(result.sections.budgets, [{
    taskRunId: "bce8ead8-2f60-4522-bcc5-d6bf56606573",
    task: "interview.agent",
    budgetScope: "agent_run:run-1",
    budgetMode: "enforce",
    tokenLimit: 500000,
    usedTokens: 501000,
    rejected: true,
    startedAt: "2026-08-03T10:00:00.000Z",
  }]);
});

test("returns explicit empty sections when a view has no rows", async () => {
  const { sql } = sqlFixture({ ai_failure_summary: [] });
  const result = await queryAIOperations(sql, {
    command: "failures",
    since: new Date("2026-08-02T12:00:00.000Z"),
    limit: 20,
  });

  assert.deepEqual(result.sections.failures, []);
  assert.equal(result.sections.summary, null);
});
