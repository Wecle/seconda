import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

const sql = postgres(connectionString, { prepare: false });

async function migrate() {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`
      DROP VIEW IF EXISTS
        ai_completion_health,
        ai_slow_operations,
        ai_interview_observability
      CASCADE
    `);
    await transaction.unsafe(`
      DROP TABLE IF EXISTS
        deep_dive_messages,
        deep_dive_sessions,
        interview_answer_assessment_claims,
        interview_answer_assessments,
        question_scores,
        interview_completion_jobs,
        interview_context_snapshots,
        interview_agent_tool_commits,
        interview_agent_events,
        interview_messages,
        interview_questions,
        interview_coverage,
        interview_shares,
        interview_resume_snapshots,
        interview_agent_runs,
        interviews
      CASCADE
    `);
    await transaction.unsafe(
      "DROP FUNCTION IF EXISTS reject_interview_resume_snapshot_update()",
    );
    await transaction.unsafe(
      "ALTER TABLE IF EXISTS resumes DROP COLUMN IF EXISTS interview_settings",
    );
    await transaction.unsafe(
      "ALTER TABLE IF EXISTS ai_task_runs DROP COLUMN IF EXISTS interview_id",
    );
    await transaction.unsafe(
      "ALTER TABLE IF EXISTS ai_task_runs DROP COLUMN IF EXISTS agent_run_id",
    );
    await transaction.unsafe(
      "ALTER TABLE IF EXISTS ai_task_runs DROP COLUMN IF EXISTS question_id",
    );
    await transaction.unsafe(
      "ALTER TABLE IF EXISTS ai_task_runs DROP COLUMN IF EXISTS completion_job_id",
    );
    await transaction.unsafe(`
      DO $$
      BEGIN
        IF to_regclass('public.ai_task_runs') IS NOT NULL THEN
          DELETE FROM ai_task_runs
          WHERE task NOT IN ('resume.parse', 'resume.generate');
        END IF;
      END
      $$
    `);
  });

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_account_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS resumes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      current_version_id UUID,
      creation_idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_creation_owner_key
    ON resumes(user_id, creation_idempotency_key)
    WHERE user_id IS NOT NULL AND creation_idempotency_key IS NOT NULL
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS resume_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'uploaded',
      original_filename TEXT,
      stored_path TEXT,
      mime_type TEXT,
      file_size INTEGER,
      extracted_text TEXT,
      parsed_json JSONB,
      parse_status TEXT NOT NULL DEFAULT 'uploaded',
      parse_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT resume_versions_source_type_check CHECK (source_type IN ('uploaded', 'generated')),
      CONSTRAINT resume_versions_generated_attachment_check CHECK (
        source_type <> 'generated'
        OR (original_filename IS NULL AND stored_path IS NULL AND mime_type IS NULL AND file_size IS NULL)
      )
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_versions_resume_number
    ON resume_versions(resume_id, version_number)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ai_task_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      operation_key TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      budget_mode TEXT NOT NULL,
      budget_scope TEXT,
      token_limit BIGINT,
      would_exceed_budget INTEGER NOT NULL DEFAULT 0,
      input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0,
      cached_input_tokens BIGINT NOT NULL DEFAULT 0,
      cache_write_tokens BIGINT NOT NULL DEFAULT 0,
      usage_unavailable_attempts INTEGER NOT NULL DEFAULT 0,
      estimated_cost_micros BIGINT,
      unpriced_attempts INTEGER NOT NULL DEFAULT 0,
      prompt_template_version TEXT,
      error_json JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_task_runs_operation_key
    ON ai_task_runs(operation_key)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ai_task_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_run_id UUID NOT NULL REFERENCES ai_task_runs(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      credential_tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      usage_available INTEGER NOT NULL DEFAULT 0,
      input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0,
      cached_input_tokens BIGINT,
      cache_write_tokens BIGINT,
      input_price_micros_per_million BIGINT,
      output_price_micros_per_million BIGINT,
      cache_read_price_micros_per_million BIGINT,
      cache_write_price_micros_per_million BIGINT,
      estimated_cost_micros BIGINT,
      first_token_ms INTEGER,
      duration_ms INTEGER,
      error_category TEXT,
      retryable INTEGER,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_task_attempts_run_number
    ON ai_task_attempts(task_run_id, attempt_number)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New agent task',
      model TEXT NOT NULL,
      capability TEXT NOT NULL DEFAULT 'workspace',
      prompt_version TEXT NOT NULL DEFAULT 'workspace-agent-v1',
      system_prompt TEXT NOT NULL,
      workspace_root TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      next_event_sequence INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT agent_sessions_status_check CHECK (status IN ('idle', 'running', 'failed')),
      CONSTRAINT agent_sessions_capability_workspace_check CHECK (
        capability <> 'workspace' OR workspace_root IS NOT NULL
      )
    )
  `;
  await sql`
    ALTER TABLE agent_sessions
      ADD COLUMN IF NOT EXISTS capability TEXT NOT NULL DEFAULT 'workspace',
      ADD COLUMN IF NOT EXISTS prompt_version TEXT NOT NULL DEFAULT 'workspace-agent-v1',
      ALTER COLUMN workspace_root DROP NOT NULL
  `;
  await sql`
    ALTER TABLE agent_sessions
      DROP CONSTRAINT IF EXISTS agent_sessions_capability_workspace_check
  `;
  await sql`
    ALTER TABLE agent_sessions
      ADD CONSTRAINT agent_sessions_capability_workspace_check CHECK (
        capability <> 'workspace' OR workspace_root IS NOT NULL
      )
  `;
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION reject_agent_session_capability_update()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.capability IS DISTINCT FROM NEW.capability THEN
        RAISE EXCEPTION 'agent session capability is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await sql.unsafe(`
    DROP TRIGGER IF EXISTS agent_sessions_capability_immutable ON agent_sessions;
    CREATE TRIGGER agent_sessions_capability_immutable
    BEFORE UPDATE OF capability ON agent_sessions
    FOR EACH ROW EXECUTE FUNCTION reject_agent_session_capability_update()
  `);
  await sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      max_steps INTEGER NOT NULL,
      input_tokens BIGINT,
      output_tokens BIGINT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      CONSTRAINT agent_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))
    )
  `;
  await sql`
    ALTER TABLE agent_runs
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
  `;
  await sql`
    UPDATE agent_runs
    SET created_at = COALESCE(started_at, NOW())
    WHERE created_at IS NULL
  `;
  await sql`
    ALTER TABLE agent_runs
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN status SET DEFAULT 'queued',
      ALTER COLUMN started_at DROP NOT NULL,
      ALTER COLUMN started_at DROP DEFAULT
  `;
  await sql`ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check`;
  await sql`
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_status_check CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
      )
  `;
  await sql.unsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM agent_runs
        WHERE status IN ('queued', 'running')
        GROUP BY session_id
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'cannot enforce one active agent run per session: duplicate queued/running rows exist';
      END IF;
    END
    $$
  `);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_session_active
    ON agent_runs(session_id)
    WHERE status IN ('queued', 'running')
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_events (
      id SERIAL PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_session_sequence
    ON agent_events(session_id, sequence)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_agent_events_session_type_sequence
    ON agent_events(session_id, type, sequence)
  `;
  await sql`
    CREATE OR REPLACE VIEW ai_slow_operations AS
    SELECT
      runs.id AS task_run_id,
      attempts.id AS attempt_id,
      runs.task,
      attempts.provider,
      attempts.model,
      attempts.attempt_number,
      attempts.status,
      attempts.first_token_ms,
      attempts.duration_ms,
      CASE
        WHEN runs.completed_at IS NULL THEN NULL
        ELSE FLOOR(EXTRACT(EPOCH FROM (runs.completed_at - runs.started_at)) * 1000)::bigint
      END AS task_duration_ms,
      attempts.started_at,
      attempts.completed_at
    FROM ai_task_attempts AS attempts
    JOIN ai_task_runs AS runs ON runs.id = attempts.task_run_id
    WHERE attempts.duration_ms IS NOT NULL
  `;

  console.log("Database migration completed");
}

migrate()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
