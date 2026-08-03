import type { BudgetMode } from "../ai/telemetry/budget";

export type AIOperationsCommand =
  | "all"
  | "summary"
  | "failures"
  | "slow"
  | "cache"
  | "completion"
  | "budgets"
  | "interview";

export type AIOperationsReport = {
  version: 1;
  generatedAt: string;
  window: { since: string; until: string };
  sections: {
    summary: {
      taskRuns: number;
      attempts: number;
      completedTasks: number;
      failedTasks: number;
      inputTokens: number;
      outputTokens: number;
      knownCostMicros: number | null;
    } | null;
    distribution: Array<{
      task: string;
      provider: string;
      model: string;
      taskRuns: number;
      attempts: number;
      successRate: number | null;
      inputTokens: number;
      outputTokens: number;
      knownCostMicros: number | null;
    }>;
    failures: Array<{
      task: string;
      provider: string;
      model: string;
      errorCategory: string | null;
      retryable: boolean | null;
      count: number;
    }>;
    slow: Array<{
      taskRunId: string;
      attemptId: string;
      task: string;
      model: string;
      firstTokenMs: number | null;
      durationMs: number | null;
      startedAt: string;
    }>;
    cache: Array<{
      task: string;
      model: string;
      promptTemplateVersion: string | null;
      availableSamples: number;
      unavailableSamples: number;
      inputTokens: number;
      cachedInputTokens: number;
      cacheWriteTokens: number;
      cacheReadRatio: number | null;
    }>;
    completion: Array<{
      completionJobId: string;
      interviewId: string;
      status: string;
      executionAttempts: number;
      requiredQuestions: number;
      scoredQuestions: number;
      failedQuestions: number;
      durationMs: number | null;
      knownCostMicros: number | null;
    }>;
    budgets: Array<{
      taskRunId: string;
      task: string;
      budgetScope: string;
      budgetMode: BudgetMode;
      tokenLimit: number;
      usedTokens: number;
      rejected: boolean;
      startedAt: string;
    }>;
    dataQuality: {
      usageUnavailableAttempts: number;
      cacheUnavailableAttempts: number;
      unpricedAttempts: number;
    } | null;
    interview: {
      interviewId: string;
      agentRuns: number;
      failedRuns: number;
      fallbackAttempts: number;
      resumeCount: number;
      inputTokens: number;
      outputTokens: number;
      knownCostMicros: number | null;
      unpricedAttempts: number;
      usageUnavailableAttempts: number;
      completionDurationMs: number | null;
    } | null;
  };
};

export type Sql = <T extends readonly Record<string, unknown>[]>(
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
) => PromiseLike<T>;

type Row = Record<string, unknown>;

const emptySections = (): AIOperationsReport["sections"] => ({
  summary: null,
  distribution: [],
  failures: [],
  slow: [],
  cache: [],
  completion: [],
  budgets: [],
  dataQuality: null,
  interview: null,
});

function requiredSafeNumber(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid operational ${field}`);
  }
  return number;
}

function nullableSafeNumber(value: unknown, field: string): number | null {
  return value === null || value === undefined
    ? null
    : requiredSafeNumber(value, field);
}

function nullableRate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error("Invalid operational rate");
  }
  return number;
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid operational timestamp");
  return date.toISOString();
}

function budgetMode(value: unknown): BudgetMode {
  if (value === "off" || value === "observe" || value === "enforce") return value;
  throw new Error("Invalid operational budget mode");
}

async function querySummary(sql: Sql, since: Date, until: Date) {
  const rows = await sql<Row[]>`
    SELECT
      COALESCE(SUM(task_count), 0)::bigint AS "taskRuns",
      COALESCE(SUM(attempt_count), 0)::bigint AS "attempts",
      COALESCE(SUM(success_count), 0)::bigint AS "completedTasks",
      COALESCE(SUM(failure_count), 0)::bigint AS "failedTasks",
      COALESCE(SUM(input_tokens), 0)::bigint AS "inputTokens",
      COALESCE(SUM(output_tokens), 0)::bigint AS "outputTokens",
      SUM(known_cost_micros)::numeric AS "knownCostMicros"
    FROM ai_task_daily_summary
    WHERE day >= date_trunc('day', ${since}::timestamptz)
      AND day <= date_trunc('day', ${until}::timestamptz)
  `;
  const row = rows[0];
  if (!row || requiredSafeNumber(row.taskRuns, "task count") === 0) return null;
  return {
    taskRuns: requiredSafeNumber(row.taskRuns, "task count"),
    attempts: requiredSafeNumber(row.attempts, "attempt count"),
    completedTasks: requiredSafeNumber(row.completedTasks, "completed task count"),
    failedTasks: requiredSafeNumber(row.failedTasks, "failed task count"),
    inputTokens: requiredSafeNumber(row.inputTokens, "input token count"),
    outputTokens: requiredSafeNumber(row.outputTokens, "output token count"),
    knownCostMicros: nullableSafeNumber(row.knownCostMicros, "known cost"),
  };
}

async function queryDistribution(sql: Sql, since: Date, until: Date, limit: number) {
  const rows = await sql<Row[]>`
    SELECT
      task,
      COALESCE(provider, 'unavailable') AS provider,
      COALESCE(model, 'unavailable') AS model,
      SUM(task_count)::bigint AS "taskRuns",
      SUM(attempt_count)::bigint AS attempts,
      CASE WHEN SUM(task_count) = 0 THEN NULL
        ELSE SUM(success_count)::numeric / SUM(task_count)
      END AS "successRate",
      COALESCE(SUM(input_tokens), 0)::bigint AS "inputTokens",
      COALESCE(SUM(output_tokens), 0)::bigint AS "outputTokens",
      SUM(known_cost_micros)::numeric AS "knownCostMicros"
    FROM ai_task_daily_summary
    WHERE day >= date_trunc('day', ${since}::timestamptz)
      AND day <= date_trunc('day', ${until}::timestamptz)
    GROUP BY task, provider, model
    ORDER BY SUM(task_count) DESC, task, provider, model
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    task: String(row.task),
    provider: String(row.provider),
    model: String(row.model),
    taskRuns: requiredSafeNumber(row.taskRuns, "task count"),
    attempts: requiredSafeNumber(row.attempts, "attempt count"),
    successRate: nullableRate(row.successRate),
    inputTokens: requiredSafeNumber(row.inputTokens, "input token count"),
    outputTokens: requiredSafeNumber(row.outputTokens, "output token count"),
    knownCostMicros: nullableSafeNumber(row.knownCostMicros, "known cost"),
  }));
}

async function queryFailures(sql: Sql, since: Date, until: Date, limit: number) {
  const rows = await sql<Row[]>`
    SELECT
      task, provider, model,
      error_category AS "errorCategory",
      retryable,
      SUM(failure_count)::bigint AS count
    FROM ai_failure_summary
    WHERE day >= date_trunc('day', ${since}::timestamptz)
      AND day <= date_trunc('day', ${until}::timestamptz)
    GROUP BY task, provider, model, error_category, retryable
    ORDER BY SUM(failure_count) DESC, task, provider, model
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    task: String(row.task),
    provider: String(row.provider),
    model: String(row.model),
    errorCategory: row.errorCategory === null ? null : String(row.errorCategory),
    retryable: row.retryable === null ? null : Number(row.retryable) === 1,
    count: requiredSafeNumber(row.count, "failure count"),
  }));
}

async function querySlow(sql: Sql, since: Date, until: Date, limit: number) {
  const rows = await sql<Row[]>`
    SELECT
      task_run_id AS "taskRunId",
      attempt_id AS "attemptId",
      task,
      model,
      first_token_ms AS "firstTokenMs",
      duration_ms AS "durationMs",
      started_at AS "startedAt"
    FROM ai_slow_operations
    WHERE started_at >= ${since} AND started_at <= ${until}
    ORDER BY duration_ms DESC NULLS LAST, started_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    taskRunId: String(row.taskRunId),
    attemptId: String(row.attemptId),
    task: String(row.task),
    model: String(row.model),
    firstTokenMs: nullableSafeNumber(row.firstTokenMs, "first token duration"),
    durationMs: nullableSafeNumber(row.durationMs, "attempt duration"),
    startedAt: iso(row.startedAt),
  }));
}

async function queryCache(sql: Sql, since: Date, until: Date, limit: number) {
  const rows = await sql<Row[]>`
    SELECT
      task,
      model,
      prompt_template_version AS "promptTemplateVersion",
      SUM(available_sample_count)::bigint AS "availableSamples",
      SUM(unavailable_sample_count)::bigint AS "unavailableSamples",
      COALESCE(SUM(input_tokens), 0)::bigint AS "inputTokens",
      COALESCE(SUM(cache_read_tokens), 0)::bigint AS "cachedInputTokens",
      COALESCE(SUM(cache_write_tokens), 0)::bigint AS "cacheWriteTokens",
      SUM(cache_read_tokens)::numeric / NULLIF(SUM(input_tokens), 0) AS "cacheReadRatio"
    FROM ai_cache_efficiency
    WHERE day >= date_trunc('day', ${since}::timestamptz)
      AND day <= date_trunc('day', ${until}::timestamptz)
    GROUP BY task, model, prompt_template_version
    ORDER BY SUM(available_sample_count + unavailable_sample_count) DESC, task, model
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    task: String(row.task),
    model: String(row.model),
    promptTemplateVersion: row.promptTemplateVersion === null
      ? null
      : String(row.promptTemplateVersion),
    availableSamples: requiredSafeNumber(row.availableSamples, "cache sample count"),
    unavailableSamples: requiredSafeNumber(row.unavailableSamples, "cache unavailable count"),
    inputTokens: requiredSafeNumber(row.inputTokens, "input token count"),
    cachedInputTokens: requiredSafeNumber(row.cachedInputTokens, "cache read token count"),
    cacheWriteTokens: requiredSafeNumber(row.cacheWriteTokens, "cache write token count"),
    cacheReadRatio: nullableRate(row.cacheReadRatio),
  }));
}

async function queryCompletion(sql: Sql, since: Date, until: Date, limit: number) {
  const rows = await sql<Row[]>`
    SELECT
      completion_job_id AS "completionJobId",
      interview_id AS "interviewId",
      status,
      execution_attempts AS "executionAttempts",
      questions_requiring_scores AS "requiredQuestions",
      scored_questions AS "scoredQuestions",
      failed_questions AS "failedQuestions",
      duration_ms AS "durationMs",
      CASE
        WHEN score_known_cost_micros IS NULL AND report_known_cost_micros IS NULL THEN NULL
        ELSE COALESCE(score_known_cost_micros, 0) + COALESCE(report_known_cost_micros, 0)
      END AS "knownCostMicros"
    FROM ai_completion_health
    WHERE started_at >= ${since} AND started_at <= ${until}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    completionJobId: String(row.completionJobId),
    interviewId: String(row.interviewId),
    status: String(row.status),
    executionAttempts: requiredSafeNumber(row.executionAttempts, "completion execution count"),
    requiredQuestions: requiredSafeNumber(row.requiredQuestions, "required question count"),
    scoredQuestions: requiredSafeNumber(row.scoredQuestions, "scored question count"),
    failedQuestions: requiredSafeNumber(row.failedQuestions, "failed question count"),
    durationMs: nullableSafeNumber(row.durationMs, "completion duration"),
    knownCostMicros: nullableSafeNumber(row.knownCostMicros, "known cost"),
  }));
}

async function queryBudgets(sql: Sql, since: Date, until: Date, limit: number) {
  const rows = await sql<Row[]>`
    SELECT
      task_run_id AS "taskRunId",
      task,
      budget_scope AS "budgetScope",
      budget_mode AS "budgetMode",
      token_limit AS "tokenLimit",
      used_tokens AS "usedTokens",
      rejected,
      started_at AS "startedAt"
    FROM ai_budget_warnings
    WHERE started_at >= ${since} AND started_at <= ${until}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    taskRunId: String(row.taskRunId),
    task: String(row.task),
    budgetScope: String(row.budgetScope),
    budgetMode: budgetMode(row.budgetMode),
    tokenLimit: requiredSafeNumber(row.tokenLimit, "token limit"),
    usedTokens: requiredSafeNumber(row.usedTokens, "used token count"),
    rejected: row.rejected === true || Number(row.rejected) === 1,
    startedAt: iso(row.startedAt),
  }));
}

async function queryDataQuality(sql: Sql, since: Date, until: Date) {
  const rows = await sql<Row[]>`
    SELECT
      COALESCE((
        SELECT SUM(usage_unavailable_attempts)
        FROM ai_task_daily_summary
        WHERE day >= date_trunc('day', ${since}::timestamptz)
          AND day <= date_trunc('day', ${until}::timestamptz)
      ), 0)::bigint AS "usageUnavailableAttempts",
      COALESCE((
        SELECT SUM(unavailable_sample_count)
        FROM ai_cache_efficiency
        WHERE day >= date_trunc('day', ${since}::timestamptz)
          AND day <= date_trunc('day', ${until}::timestamptz)
      ), 0)::bigint AS "cacheUnavailableAttempts",
      COALESCE((
        SELECT SUM(unpriced_attempts)
        FROM ai_task_daily_summary
        WHERE day >= date_trunc('day', ${since}::timestamptz)
          AND day <= date_trunc('day', ${until}::timestamptz)
      ), 0)::bigint AS "unpricedAttempts"
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    usageUnavailableAttempts: requiredSafeNumber(
      row.usageUnavailableAttempts,
      "usage unavailable count",
    ),
    cacheUnavailableAttempts: requiredSafeNumber(
      row.cacheUnavailableAttempts,
      "cache unavailable count",
    ),
    unpricedAttempts: requiredSafeNumber(row.unpricedAttempts, "unpriced count"),
  };
}

async function queryInterview(sql: Sql, since: Date, until: Date, interviewId: string) {
  const rows = await sql<Row[]>`
    SELECT
      interview_id AS "interviewId",
      COALESCE(agent_run_count, 0)::bigint AS "agentRuns",
      COALESCE(failed_agent_run_count, 0)::bigint AS "failedRuns",
      COALESCE(retry_fallback_count, 0)::bigint AS "fallbackAttempts",
      COALESCE(recovery_count, 0)::bigint AS "resumeCount",
      COALESCE(input_tokens, 0)::bigint AS "inputTokens",
      COALESCE(output_tokens, 0)::bigint AS "outputTokens",
      known_cost_micros AS "knownCostMicros",
      COALESCE(unpriced_attempts, 0)::bigint AS "unpricedAttempts",
      COALESCE(usage_unavailable_attempts, 0)::bigint AS "usageUnavailableAttempts",
      completion_latency_ms AS "completionDurationMs"
    FROM ai_interview_observability
    WHERE interview_id = ${interviewId}
      AND latest_task_at >= ${since}
      AND earliest_task_at <= ${until}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    interviewId: String(row.interviewId),
    agentRuns: requiredSafeNumber(row.agentRuns, "agent run count"),
    failedRuns: requiredSafeNumber(row.failedRuns, "failed agent run count"),
    fallbackAttempts: requiredSafeNumber(row.fallbackAttempts, "fallback count"),
    resumeCount: requiredSafeNumber(row.resumeCount, "resume count"),
    inputTokens: requiredSafeNumber(row.inputTokens, "input token count"),
    outputTokens: requiredSafeNumber(row.outputTokens, "output token count"),
    knownCostMicros: nullableSafeNumber(row.knownCostMicros, "known cost"),
    unpricedAttempts: requiredSafeNumber(row.unpricedAttempts, "unpriced count"),
    usageUnavailableAttempts: requiredSafeNumber(
      row.usageUnavailableAttempts,
      "usage unavailable count",
    ),
    completionDurationMs: nullableSafeNumber(
      row.completionDurationMs,
      "completion duration",
    ),
  };
}

export async function queryAIOperations(
  sql: Sql,
  input: {
    command: AIOperationsCommand;
    since: Date;
    limit: number;
    interviewId?: string;
  },
): Promise<AIOperationsReport> {
  const until = new Date();
  const sections = emptySections();
  const tasks: Array<Promise<void>> = [];
  const include = (command: AIOperationsCommand) =>
    input.command === "all" || input.command === command;

  if (include("summary")) {
    tasks.push(Promise.resolve(querySummary(sql, input.since, until)).then((value) => {
      sections.summary = value;
    }));
    tasks.push(Promise.resolve(queryDistribution(sql, input.since, until, input.limit)).then((value) => {
      sections.distribution = value;
    }));
    tasks.push(Promise.resolve(queryDataQuality(sql, input.since, until)).then((value) => {
      sections.dataQuality = value;
    }));
  }
  if (include("failures")) {
    tasks.push(Promise.resolve(queryFailures(sql, input.since, until, input.limit)).then((value) => {
      sections.failures = value;
    }));
  }
  if (include("slow")) {
    tasks.push(Promise.resolve(querySlow(sql, input.since, until, input.limit)).then((value) => {
      sections.slow = value;
    }));
  }
  if (include("cache")) {
    tasks.push(Promise.resolve(queryCache(sql, input.since, until, input.limit)).then((value) => {
      sections.cache = value;
    }));
  }
  if (include("completion")) {
    tasks.push(Promise.resolve(queryCompletion(sql, input.since, until, input.limit)).then((value) => {
      sections.completion = value;
    }));
  }
  if (include("budgets")) {
    tasks.push(Promise.resolve(queryBudgets(sql, input.since, until, input.limit)).then((value) => {
      sections.budgets = value;
    }));
  }
  if (input.command === "interview") {
    if (!input.interviewId) throw new Error("Interview ID is required");
    tasks.push(Promise.resolve(queryInterview(sql, input.since, until, input.interviewId)).then((value) => {
      sections.interview = value;
    }));
  }

  await Promise.all(tasks);
  return {
    version: 1,
    generatedAt: until.toISOString(),
    window: { since: input.since.toISOString(), until: until.toISOString() },
    sections,
  };
}
