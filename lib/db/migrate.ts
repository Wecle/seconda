import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

const sql = postgres(connectionString, { prepare: false });

async function migrate() {
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
      dedupe_key TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      visibility TEXT NOT NULL DEFAULT 'model',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE agent_events
      ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
      ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'model'
  `;
  await sql`ALTER TABLE agent_events DROP CONSTRAINT IF EXISTS agent_events_schema_version_check`;
  await sql`
    ALTER TABLE agent_events
      ADD CONSTRAINT agent_events_schema_version_check CHECK (schema_version > 0)
  `;
  await sql`ALTER TABLE agent_events DROP CONSTRAINT IF EXISTS agent_events_visibility_check`;
  await sql`
    ALTER TABLE agent_events
      ADD CONSTRAINT agent_events_visibility_check CHECK (
        visibility IN ('model', 'user', 'model_and_user', 'internal')
      )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_session_sequence
    ON agent_events(session_id, sequence)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_session_dedupe_key
    ON agent_events(session_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_agent_events_session_type_sequence
    ON agent_events(session_id, type, sequence)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS interviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      creation_idempotency_key TEXT NOT NULL,
      creation_request_hash TEXT NOT NULL,
      agent_session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      resume_version_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'initializing',
      language TEXT NOT NULL,
      persona TEXT NOT NULL,
      interview_type TEXT NOT NULL,
      target_level TEXT NOT NULL,
      target_role TEXT NOT NULL,
      preference TEXT NOT NULL DEFAULT '',
      preference_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      target_round_count INTEGER NOT NULL,
      answered_round_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT interviews_status_check CHECK (status IN ('initializing', 'active', 'completing', 'completed')),
      CONSTRAINT interviews_language_check CHECK (language IN ('zh', 'en', 'es', 'de')),
      CONSTRAINT interviews_persona_check CHECK (persona IN ('friendly', 'standard', 'stressful')),
      CONSTRAINT interviews_type_check CHECK (interview_type IN ('behavioral', 'technical', 'mixed')),
      CONSTRAINT interviews_target_level_check CHECK (target_level IN ('Junior', 'Mid', 'Senior')),
      CONSTRAINT interviews_target_round_count_check CHECK (target_round_count BETWEEN 1 AND 20),
      CONSTRAINT interviews_answered_round_count_check CHECK (
        answered_round_count >= 0 AND answered_round_count <= target_round_count
      ),
      CONSTRAINT interviews_version_check CHECK (version > 0),
      CONSTRAINT interviews_preference_tags_check CHECK (
        jsonb_typeof(preference_tags) = 'array' AND jsonb_array_length(preference_tags) <= 3
      )
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_owner_creation_key
    ON interviews(user_id, creation_idempotency_key)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_agent_session
    ON interviews(agent_session_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_interviews_owner_created
    ON interviews(user_id, created_at)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_resume_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      resume_id UUID NOT NULL,
      resume_version_id UUID NOT NULL,
      resume_title TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      parsed_json JSONB NOT NULL,
      canonical_text TEXT NOT NULL,
      evidence_json JSONB NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT interview_resume_snapshots_version_check CHECK (version_number > 0),
      CONSTRAINT interview_resume_snapshots_source_type_check CHECK (source_type IN ('uploaded', 'generated'))
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_resume_snapshots_interview
    ON interview_resume_snapshots(interview_id)
  `;
  await sql.unsafe(`
    ALTER TABLE interviews ALTER COLUMN resume_version_id SET NOT NULL;
    ALTER TABLE interviews DROP CONSTRAINT IF EXISTS interviews_resume_version_id_fkey;
    ALTER TABLE interview_resume_snapshots ALTER COLUMN resume_id SET NOT NULL;
    ALTER TABLE interview_resume_snapshots ALTER COLUMN resume_version_id SET NOT NULL;
    ALTER TABLE interview_resume_snapshots DROP CONSTRAINT IF EXISTS interview_resume_snapshots_resume_id_fkey;
    ALTER TABLE interview_resume_snapshots DROP CONSTRAINT IF EXISTS interview_resume_snapshots_resume_version_id_fkey;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION reject_interview_resume_snapshot_update()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'interview resume snapshots are immutable';
    END;
    $$ LANGUAGE plpgsql
  `);
  await sql.unsafe(`
    DROP TRIGGER IF EXISTS interview_resume_snapshots_immutable ON interview_resume_snapshots;
    CREATE TRIGGER interview_resume_snapshots_immutable
    BEFORE UPDATE ON interview_resume_snapshots
    FOR EACH ROW EXECUTE FUNCTION reject_interview_resume_snapshot_update()
  `);
  await sql`
    CREATE TABLE IF NOT EXISTS interview_agent_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      current_agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
      trigger_type TEXT NOT NULL,
      trigger_key TEXT NOT NULL,
      trigger_answer_id UUID,
      status TEXT NOT NULL DEFAULT 'queued',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      attempt_generation INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      error_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT interview_agent_runs_trigger_type_check CHECK (trigger_type IN ('opening', 'answer', 'skip')),
      CONSTRAINT interview_agent_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      CONSTRAINT interview_agent_runs_attempt_count_check CHECK (attempt_count >= 0),
      CONSTRAINT interview_agent_runs_generation_check CHECK (attempt_generation >= 0),
      CONSTRAINT interview_agent_runs_trigger_answer_check CHECK (
        (trigger_type = 'opening' AND trigger_answer_id IS NULL)
        OR (trigger_type IN ('answer', 'skip') AND trigger_answer_id IS NOT NULL)
      )
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_agent_runs_trigger
    ON interview_agent_runs(interview_id, trigger_key)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_agent_runs_current_agent_run
    ON interview_agent_runs(current_agent_run_id)
    WHERE current_agent_run_id IS NOT NULL
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_interview_agent_runs_status_lease
    ON interview_agent_runs(status, lease_expires_at)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      source_interview_run_id UUID NOT NULL REFERENCES interview_agent_runs(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      topic TEXT NOT NULL,
      question TEXT NOT NULL,
      tip TEXT,
      resume_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'awaiting_answer',
      asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      CONSTRAINT interview_questions_sequence_check CHECK (sequence > 0),
      CONSTRAINT interview_questions_kind_check CHECK (kind IN ('main', 'follow_up')),
      CONSTRAINT interview_questions_status_check CHECK (status IN ('awaiting_answer', 'answered', 'skipped', 'abandoned')),
      CONSTRAINT interview_questions_evidence_check CHECK (jsonb_typeof(resume_evidence_ids) = 'array')
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_questions_sequence
    ON interview_questions(interview_id, sequence)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_questions_source_run
    ON interview_questions(source_interview_run_id)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_questions_one_awaiting
    ON interview_questions(interview_id)
    WHERE status = 'awaiting_answer'
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_answers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES interview_questions(id) ON DELETE RESTRICT,
      submission_key TEXT NOT NULL,
      submission_request_hash TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      analysis_json JSONB,
      analysis_run_id UUID REFERENCES interview_agent_runs(id) ON DELETE SET NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT interview_answers_status_check CHECK (status IN ('answered', 'skipped')),
      CONSTRAINT interview_answers_content_check CHECK (
        (status = 'answered' AND length(btrim(content)) > 0)
        OR (status = 'skipped' AND content = '')
      )
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_answers_question
    ON interview_answers(question_id)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_answers_submission_key
    ON interview_answers(interview_id, submission_key)
  `;
  await sql.unsafe(`
    ALTER TABLE interview_questions
      DROP CONSTRAINT IF EXISTS interview_questions_source_interview_run_id_fkey;
    ALTER TABLE interview_questions
      ADD CONSTRAINT interview_questions_source_interview_run_id_fkey
      FOREIGN KEY (source_interview_run_id) REFERENCES interview_agent_runs(id) ON DELETE RESTRICT;
    ALTER TABLE interview_answers
      DROP CONSTRAINT IF EXISTS interview_answers_question_id_fkey;
    ALTER TABLE interview_answers
      ADD CONSTRAINT interview_answers_question_id_fkey
      FOREIGN KEY (question_id) REFERENCES interview_questions(id) ON DELETE RESTRICT;
    ALTER TABLE interview_agent_runs
      DROP CONSTRAINT IF EXISTS interview_agent_runs_trigger_answer_fk;
    ALTER TABLE interview_agent_runs
      ADD CONSTRAINT interview_agent_runs_trigger_answer_fk
      FOREIGN KEY (trigger_answer_id) REFERENCES interview_answers(id) ON DELETE RESTRICT;
  `);
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
