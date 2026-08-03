import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env");
  } catch {}
}

const databaseUrl = process.env.DATABASE_URL;

const expectedRelations = [
  "ai_cache_efficiency",
  "ai_completion_health",
  "ai_failure_summary",
  "ai_interview_observability",
  "ai_slow_operations",
  "ai_task_attempts",
  "ai_task_daily_summary",
  "ai_task_runs",
];

test("migration creates the AI telemetry tables, constraints, indexes, and views idempotently", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  execFileSync("pnpm", ["db:migrate"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "pipe",
  });
  execFileSync("pnpm", ["db:migrate"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "pipe",
  });

  const sql = postgres(databaseUrl!, { prepare: false });
  try {
    const relations = await sql<{ name: string }[]>`
      SELECT relname AS name
      FROM pg_class
      WHERE relname IN (
        'ai_task_runs',
        'ai_task_attempts',
        'ai_task_daily_summary',
        'ai_interview_observability',
        'ai_failure_summary',
        'ai_slow_operations',
        'ai_cache_efficiency',
        'ai_completion_health'
      )
      ORDER BY relname
    `;
    assert.deepEqual(relations.map(({ name }) => name), expectedRelations);

    const constraints = await sql<{ name: string; definition: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN ('ai_task_runs'::regclass, 'ai_task_attempts'::regclass)
        AND conname IN (
          'ai_task_runs_task_check',
          'ai_task_runs_status_check',
          'ai_task_runs_budget_mode_check',
          'ai_task_runs_budget_flag_check',
          'ai_task_runs_token_limit_check',
          'ai_task_runs_nonnegative_check',
          'ai_task_attempts_status_check',
          'ai_task_attempts_provider_check',
          'ai_task_attempts_credential_tier_check',
          'ai_task_attempts_usage_available_check',
          'ai_task_attempts_retryable_check',
          'ai_task_attempts_positive_number_check',
          'ai_task_attempts_nonnegative_check'
        )
    `;
    assert.equal(constraints.length, 13);
    const constraintDefinitions = new Map(
      constraints.map(({ name, definition }) => [name, definition]),
    );
    for (const name of [
      "ai_task_runs_token_limit_check",
      "ai_task_runs_nonnegative_check",
      "ai_task_attempts_nonnegative_check",
    ]) {
      assert.match(constraintDefinitions.get(name)!, /9007199254740991/);
    }
    assert.match(constraintDefinitions.get("ai_task_runs_task_check")!, /coach\.evaluate/);
    assert.match(constraintDefinitions.get("ai_task_runs_status_check")!, /budget_exceeded/);
    assert.match(constraintDefinitions.get("ai_task_runs_budget_mode_check")!, /observe/);
    assert.match(constraintDefinitions.get("ai_task_runs_budget_flag_check")!, /would_exceed_budget/);
    assert.match(constraintDefinitions.get("ai_task_attempts_status_check")!, /budget_rejected/);
    assert.match(constraintDefinitions.get("ai_task_attempts_provider_check")!, /zhipu/);
    assert.match(constraintDefinitions.get("ai_task_attempts_credential_tier_check")!, /quality/);
    assert.match(constraintDefinitions.get("ai_task_attempts_usage_available_check")!, /usage_available/);
    assert.match(constraintDefinitions.get("ai_task_attempts_retryable_check")!, /retryable/);
    assert.match(constraintDefinitions.get("ai_task_attempts_positive_number_check")!, /attempt_number/);

    const requiredColumns = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND is_nullable = 'NO'
        AND (
          (table_name = 'ai_task_runs' AND column_name IN (
            'operation_key', 'task', 'status', 'budget_mode', 'would_exceed_budget',
            'input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_write_tokens',
            'usage_unavailable_attempts', 'unpriced_attempts', 'started_at', 'created_at', 'updated_at'
          ))
          OR
          (table_name = 'ai_task_attempts' AND column_name IN (
            'task_run_id', 'attempt_number', 'provider', 'model', 'credential_tier',
            'status', 'usage_available', 'input_tokens', 'output_tokens', 'started_at', 'created_at'
          ))
        )
    `;
    assert.equal(requiredColumns[0].count, "25");

    const indexes = await sql<{ name: string }[]>`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'idx_ai_task_runs_operation_key',
          'idx_ai_task_runs_task_started',
          'idx_ai_task_runs_status_started',
          'idx_ai_task_runs_budget_scope_started',
          'idx_ai_task_runs_interview_started',
          'idx_ai_task_runs_agent_run',
          'idx_ai_task_runs_question',
          'idx_ai_task_runs_completion_job',
          'idx_ai_task_attempts_run_number',
          'idx_ai_task_attempts_model_started',
          'idx_ai_task_attempts_status_started'
        )
    `;
    assert.equal(indexes.length, 11);

    const bigintColumns = await sql<{ tableName: string; columnName: string }[]>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND data_type = 'bigint'
        AND (
          (table_name = 'ai_task_runs' AND column_name IN (
            'token_limit', 'input_tokens', 'output_tokens', 'cached_input_tokens',
            'cache_write_tokens', 'estimated_cost_micros'
          ))
          OR
          (table_name = 'ai_task_attempts' AND column_name IN (
            'input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_write_tokens',
            'input_price_micros_per_million', 'output_price_micros_per_million',
            'cache_read_price_micros_per_million', 'cache_write_price_micros_per_million',
            'estimated_cost_micros'
          ))
        )
    `;
    assert.equal(bigintColumns.length, 15);

    const uniquenessIndexes = await sql<{ tableName: string }[]>`
      SELECT tablename AS "tableName"
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND (
          (tablename = 'ai_task_runs' AND indexdef ~ '\\(operation_key\\)')
          OR
          (tablename = 'ai_task_attempts' AND indexdef ~ '\\(task_run_id, attempt_number\\)')
        )
    `;
    assert.deepEqual(
      uniquenessIndexes.map(({ tableName }) => tableName).sort(),
      ["ai_task_attempts", "ai_task_runs"],
    );

    const operationKey = randomUUID();
    const model = `semantic-test-${randomUUID()}`;
    const [taskRun] = await sql<{ id: string }[]>`
      INSERT INTO ai_task_runs (operation_key, task, status, budget_mode)
      VALUES (${operationKey}, 'resume.parse', 'completed', 'observe')
      RETURNING id
    `;
    try {
      await sql`
        INSERT INTO ai_task_attempts (
          task_run_id, attempt_number, provider, model, credential_tier, status,
          usage_available, input_tokens, output_tokens, cached_input_tokens, cache_write_tokens,
          input_price_micros_per_million, output_price_micros_per_million,
          cache_read_price_micros_per_million, cache_write_price_micros_per_million,
          first_token_ms, duration_ms
        ) VALUES
          (${taskRun.id}, 1, 'openai', ${model}, 'fast', 'completed', 1, 10, 5, 2, 1, 1, 1, 1, 1, 20, 100),
          (${taskRun.id}, 2, 'openai', ${model}, 'fast', 'failed', 0, 0, 0, NULL, NULL, 1, 1, NULL, NULL, NULL, 200),
          (${taskRun.id}, 3, 'openai', ${model}, 'fast', 'completed', 1, 10, 5, NULL, NULL, 1, 1, NULL, NULL, NULL, 300),
          (${taskRun.id}, 4, 'openai', ${model}, 'fast', 'completed', 1, 10, 5, NULL, NULL, NULL, 1, NULL, NULL, NULL, 400),
          (${taskRun.id}, 5, 'openai', ${model}, 'fast', 'completed', 1, 10, 5, 2, NULL, 1, 1, NULL, NULL, NULL, 500)
      `;
      const [summary] = await sql<{
        unpricedAttempts: string;
        usageUnavailableAttempts: string;
        knownCostMicros: string | null;
        taskCount: string;
        attemptCount: string;
        successCount: string;
        failureCount: string;
        fallbackCount: string;
        inputTokens: string;
        durationP50Ms: number;
      }[]>`
        SELECT
          unpriced_attempts::text AS "unpricedAttempts",
          usage_unavailable_attempts::text AS "usageUnavailableAttempts",
          known_cost_micros::text AS "knownCostMicros",
          task_count::text AS "taskCount",
          attempt_count::text AS "attemptCount",
          success_count::text AS "successCount",
          failure_count::text AS "failureCount",
          fallback_count::text AS "fallbackCount",
          input_tokens::text AS "inputTokens",
          duration_p50_ms AS "durationP50Ms"
        FROM ai_task_daily_summary
        WHERE model = ${model}
      `;
      assert.equal(summary.unpricedAttempts, "2");
      assert.equal(summary.usageUnavailableAttempts, "1");
      assert.equal(summary.knownCostMicros, null);
      assert.equal(summary.taskCount, "1");
      assert.equal(summary.attemptCount, "5");
      assert.equal(summary.successCount, "1");
      assert.equal(summary.failureCount, "0");
      assert.equal(summary.fallbackCount, "4");
      assert.equal(summary.inputTokens, "40");
      assert.equal(summary.durationP50Ms, 300);

      const [failure] = await sql<{ failureCount: string; budgetRejection: boolean }[]>`
        SELECT failure_count::text AS "failureCount", budget_rejection AS "budgetRejection"
        FROM ai_failure_summary
        WHERE model = ${model}
      `;
      assert.deepEqual(failure, { failureCount: "1", budgetRejection: false });

      const [cache] = await sql<{ available: string; unavailable: string; ratio: number }[]>`
        SELECT
          available_sample_count::text AS available,
          unavailable_sample_count::text AS unavailable,
          cache_read_ratio::double precision AS ratio
        FROM ai_cache_efficiency
        WHERE model = ${model}
      `;
      assert.deepEqual(cache, { available: "2", unavailable: "3", ratio: 0.2 });

      const slow = await sql<{ durationMs: number }[]>`
        SELECT duration_ms AS "durationMs"
        FROM ai_slow_operations
        WHERE model = ${model}
        ORDER BY duration_ms
      `;
      assert.deepEqual(slow.map(({ durationMs }) => durationMs), [100, 200, 300, 400, 500]);

      const noAttemptKey = randomUUID();
      const [noAttemptRun] = await sql<{ id: string }[]>`
        INSERT INTO ai_task_runs (operation_key, task, status, budget_mode, token_limit, started_at)
        VALUES (${noAttemptKey}, 'resume.generate', 'failed', 'observe', 0, TIMESTAMPTZ '2000-01-02 00:00:00+00')
        RETURNING id
      `;
      try {
        const [noAttemptSummary] = await sql<{
          taskCount: string;
          attemptCount: string;
          failureCount: string;
          provider: string | null;
          inputTokens: string | null;
        }[]>`
          SELECT
            task_count::text AS "taskCount",
            attempt_count::text AS "attemptCount",
            failure_count::text AS "failureCount",
            provider,
            input_tokens::text AS "inputTokens"
          FROM ai_task_daily_summary
          WHERE task = 'resume.generate' AND provider IS NULL AND model IS NULL
            AND day = TIMESTAMPTZ '2000-01-02 00:00:00+00'
        `;
        assert.deepEqual(noAttemptSummary, {
          taskCount: "1",
          attemptCount: "0",
          failureCount: "1",
          provider: null,
          inputTokens: null,
        });
      } finally {
        await sql`DELETE FROM ai_task_runs WHERE id = ${noAttemptRun.id}`;
      }

      const boundaryKey = randomUUID();
      const [boundaryRun] = await sql<{ id: string }[]>`
        INSERT INTO ai_task_runs (operation_key, task, status, budget_mode, token_limit)
        VALUES (${boundaryKey}, 'resume.parse', 'running', 'observe', 9007199254740991)
        RETURNING id
      `;
      try {
        await assert.rejects(async () => {
          await sql`UPDATE ai_task_runs SET token_limit = 9007199254740992 WHERE id = ${boundaryRun.id}`;
        });
        await assert.rejects(async () => {
          await sql`
            INSERT INTO ai_task_runs (operation_key, task, status, budget_mode)
            VALUES (${boundaryKey}, 'resume.parse', 'running', 'observe')
          `;
        });
        await assert.rejects(async () => {
          await sql`
            INSERT INTO ai_task_runs (operation_key, task, status, budget_mode)
            VALUES (${randomUUID()}, NULL, 'running', 'observe')
          `;
        });
        await assert.rejects(async () => {
          await sql`
            INSERT INTO ai_task_attempts (
              task_run_id, attempt_number, provider, model, credential_tier
            ) VALUES (${taskRun.id}, 1, 'openai', ${model}, 'fast')
          `;
        });
        await assert.rejects(async () => {
          await sql`
            UPDATE ai_task_attempts
            SET input_price_micros_per_million = 9007199254740992
            WHERE task_run_id = ${taskRun.id} AND attempt_number = 1
          `;
        });
      } finally {
        await sql`DELETE FROM ai_task_runs WHERE id = ${boundaryRun.id}`;
      }

      const [interview] = await sql<{ id: string }[]>`
        INSERT INTO interviews (level, type, language, question_count, persona, status)
        VALUES ('mid', 'general', 'zh', 1, 'standard', 'completed')
        RETURNING id
      `;
      try {
        const [agentRun] = await sql<{ id: string }[]>`
          INSERT INTO interview_agent_runs (
            interview_id, idempotency_key, status, phase, resume_count, completed_at
          ) VALUES (${interview.id}, ${randomUUID()}, 'failed', 'failed', 2, NOW())
          RETURNING id
        `;
        const [completionJob] = await sql<{ id: string }[]>`
          INSERT INTO interview_completion_jobs (
            interview_id, status, attempt_count, completed_at
          ) VALUES (${interview.id}, 'completed', 1, NOW())
          RETURNING id
        `;
        const [question] = await sql<{ id: string }[]>`
          INSERT INTO interview_questions (
            interview_id, question_index, question_type, question, answer_text, score_status
          ) VALUES (${interview.id}, 1, 'behavioral', 'Question?', 'Answer.', 'failed')
          RETURNING id
        `;
        const telemetryRuns = await sql<{ id: string; task: string }[]>`
          INSERT INTO ai_task_runs (
            operation_key, task, status, budget_mode, interview_id, agent_run_id,
            question_id, completion_job_id
          ) VALUES
            (${randomUUID()}, 'interview.agent', 'failed', 'observe', ${interview.id}, ${agentRun.id}, NULL, NULL),
            (${randomUUID()}, 'answer.score', 'failed', 'observe', ${interview.id}, NULL, ${question.id}, ${completionJob.id}),
            (${randomUUID()}, 'report.generate', 'completed', 'observe', ${interview.id}, NULL, NULL, ${completionJob.id})
          RETURNING id, task
        `;
        const taskId = new Map(telemetryRuns.map((run) => [run.task, run.id]));
        await sql`
          INSERT INTO ai_task_attempts (
            task_run_id, attempt_number, provider, model, credential_tier, status,
            usage_available, input_tokens, output_tokens,
            input_price_micros_per_million, output_price_micros_per_million,
            estimated_cost_micros, duration_ms
          ) VALUES
            (${taskId.get("interview.agent")!}, 1, 'openai', ${`agent-${model}`}, 'fast', 'failed', 1, 7, 3, 1, 1, 2, 50),
            (${taskId.get("answer.score")!}, 1, 'openai', ${`score-${model}`}, 'quality', 'failed', 1, 11, 5, 1, 1, 3, 60),
            (${taskId.get("report.generate")!}, 1, 'openai', ${`report-${model}`}, 'quality', 'completed', 1, 13, 7, 1, 1, 4, 70)
        `;

        const [interviewHealth] = await sql<{
          agentRuns: string;
          failedRuns: string;
          retries: string;
          recoveries: string;
          inputTokens: string;
          outputTokens: string;
          cost: string;
          unpriced: string;
          unavailable: string;
        }[]>`
          SELECT
            agent_run_count::text AS "agentRuns",
            failed_agent_run_count::text AS "failedRuns",
            retry_fallback_count::text AS retries,
            recovery_count::text AS recoveries,
            input_tokens::text AS "inputTokens",
            output_tokens::text AS "outputTokens",
            known_cost_micros::text AS cost,
            unpriced_attempts::text AS unpriced,
            usage_unavailable_attempts::text AS unavailable
          FROM ai_interview_observability
          WHERE interview_id = ${interview.id}
        `;
        assert.deepEqual(interviewHealth, {
          agentRuns: "1",
          failedRuns: "1",
          retries: "0",
          recoveries: "2",
          inputTokens: "31",
          outputTokens: "15",
          cost: "9",
          unpriced: "0",
          unavailable: "0",
        });

        const [completionHealth] = await sql<{
          executionAttempts: number;
          requiring: string;
          scored: string;
          failed: string;
          scoreInput: string;
          scoreCost: string;
          reportInput: string;
          reportCost: string;
          durationMs: string;
        }[]>`
          SELECT
            execution_attempts AS "executionAttempts",
            questions_requiring_scores::text AS requiring,
            scored_questions::text AS scored,
            failed_questions::text AS failed,
            score_input_tokens::text AS "scoreInput",
            score_known_cost_micros::text AS "scoreCost",
            report_input_tokens::text AS "reportInput",
            report_known_cost_micros::text AS "reportCost",
            duration_ms::text AS "durationMs"
          FROM ai_completion_health
          WHERE completion_job_id = ${completionJob.id}
        `;
        assert.deepEqual(completionHealth, {
          executionAttempts: 1,
          requiring: "1",
          scored: "0",
          failed: "1",
          scoreInput: "11",
          scoreCost: "3",
          reportInput: "13",
          reportCost: "4",
          durationMs: completionHealth.durationMs,
        });
        assert.ok(Number(completionHealth.durationMs) >= 0);
      } finally {
        await sql`DELETE FROM interviews WHERE id = ${interview.id}`;
      }
    } finally {
      await sql`DELETE FROM ai_task_runs WHERE id = ${taskRun.id}`;
    }
  } finally {
    await sql.end();
  }
});
