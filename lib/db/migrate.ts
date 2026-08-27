import postgres from "postgres";
import {
  computeInterviewAggregates,
  DIMENSIONS,
  dimensionAveragesSchema,
  questionFeedbackSchema,
  questionScoresSchema,
  reportSummarySchema,
  validateQuestionOverall,
  type ReportSummary,
  type ScoredQuestionInput,
} from "@/lib/interview/domain/scoring";

const MIGRATION_FALLBACK_REPORT_SUMMARY: ReportSummary = {
  overallSummary: "Historical report summary is unavailable.",
  keyStrengths: ["Historical strengths summary is unavailable."],
  keyImprovements: ["Historical improvement summary is unavailable."],
  recommendations: "Regenerate the interview report to obtain a complete assessment.",
};

let defaultSql: postgres.Sql | null = null;
function getDefaultSql(): postgres.Sql {
  if (!defaultSql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    defaultSql = postgres(connectionString, { prepare: false });
  }
  return defaultSql;
}

export async function migrateDatabase(customSql?: postgres.Sql) {
  const sql = customSql ?? getDefaultSql();
  await sql.begin(async (tx) => {
    await runMigration(tx as unknown as postgres.Sql);
  });
}

async function runMigration(sql: postgres.Sql) {
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
      interview_settings JSONB,
      creation_idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE resumes
      ADD COLUMN IF NOT EXISTS interview_settings JSONB
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
    CREATE TABLE IF NOT EXISTS question_scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id UUID NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
      understanding INTEGER,
      expression INTEGER,
      logic INTEGER,
      depth INTEGER,
      authenticity INTEGER,
      reflection INTEGER,
      overall NUMERIC(3, 1),
      feedback_json JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      claim_token TEXT,
      claim_expires_at TIMESTAMPTZ,
      error_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE question_scores
      ADD COLUMN IF NOT EXISTS status TEXT,
      ADD COLUMN IF NOT EXISTS attempt_count INTEGER,
      ADD COLUMN IF NOT EXISTS claim_token TEXT,
      ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS error_json JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
  `;
  await sql`
    UPDATE question_scores
    SET status = 'pending'
    WHERE status IS NULL
  `;
  await sql`
    UPDATE question_scores
    SET attempt_count = 0
    WHERE attempt_count IS NULL
  `;
  await sql`
    UPDATE question_scores
    SET created_at = NOW()
    WHERE created_at IS NULL
  `;
  await sql`
    UPDATE question_scores
    SET updated_at = NOW()
    WHERE updated_at IS NULL
  `;
  await sql`
    UPDATE question_scores
    SET claim_token = NULL, claim_expires_at = NULL
    WHERE status IN ('pending', 'scored', 'failed')
  `;
  await sql`
    UPDATE question_scores
    SET status = 'pending', claim_token = NULL, claim_expires_at = NULL, error_json = NULL, updated_at = NOW()
    WHERE status = 'scoring' AND (claim_token IS NULL OR claim_expires_at IS NULL)
  `;
  await sql`
    ALTER TABLE question_scores
      ALTER COLUMN status SET DEFAULT 'pending',
      ALTER COLUMN status SET NOT NULL,
      ALTER COLUMN attempt_count SET DEFAULT 0,
      ALTER COLUMN attempt_count SET NOT NULL,
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT NOW(),
      ALTER COLUMN updated_at SET NOT NULL
  `;
  await sql`ALTER TABLE question_scores DROP CONSTRAINT IF EXISTS question_scores_status_check`;
  await sql`ALTER TABLE question_scores DROP CONSTRAINT IF EXISTS question_scores_attempt_count_check`;
  await sql`ALTER TABLE question_scores DROP CONSTRAINT IF EXISTS question_scores_overall_check`;
  await sql`ALTER TABLE question_scores DROP CONSTRAINT IF EXISTS question_scores_dimension_bounds_check`;
  await sql`ALTER TABLE question_scores DROP CONSTRAINT IF EXISTS question_scores_scored_check`;
  await sql`
    ALTER TABLE question_scores
      ADD CONSTRAINT question_scores_status_check CHECK (
        (status = 'pending' AND claim_token IS NULL AND claim_expires_at IS NULL)
        OR (status = 'scoring' AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
        OR (status = 'scored' AND claim_token IS NULL AND claim_expires_at IS NULL
            AND understanding IS NOT NULL AND expression IS NOT NULL AND logic IS NOT NULL
            AND depth IS NOT NULL AND authenticity IS NOT NULL AND reflection IS NOT NULL
            AND overall IS NOT NULL AND feedback_json IS NOT NULL)
        OR (status = 'failed' AND claim_token IS NULL AND claim_expires_at IS NULL)
      ),
      ADD CONSTRAINT question_scores_attempt_count_check CHECK (attempt_count >= 0),
      ADD CONSTRAINT question_scores_overall_check CHECK (overall IS NULL OR (overall >= 0.0 AND overall <= 10.0)),
      ADD CONSTRAINT question_scores_dimension_bounds_check CHECK (
        (understanding IS NULL OR (understanding >= 0 AND understanding <= 10))
        AND (expression IS NULL OR (expression >= 0 AND expression <= 10))
        AND (logic IS NULL OR (logic >= 0 AND logic <= 10))
        AND (depth IS NULL OR (depth >= 0 AND depth <= 10))
        AND (authenticity IS NULL OR (authenticity >= 0 AND authenticity <= 10))
        AND (reflection IS NULL OR (reflection >= 0 AND reflection <= 10))
      )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_question_scores_question
    ON question_scores(question_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_completion_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      claim_token TEXT,
      claim_expires_at TIMESTAMPTZ,
      error_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `;
  await sql`
    ALTER TABLE interview_completion_jobs
      ADD COLUMN IF NOT EXISTS status TEXT,
      ADD COLUMN IF NOT EXISTS attempt_count INTEGER,
      ADD COLUMN IF NOT EXISTS claim_token TEXT,
      ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS error_json JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ
  `;
  await sql`
    UPDATE interview_completion_jobs
    SET status = 'pending'
    WHERE status IS NULL
  `;
  await sql`
    UPDATE interview_completion_jobs
    SET attempt_count = 0
    WHERE attempt_count IS NULL
  `;
  await sql`
    UPDATE interview_completion_jobs
    SET created_at = NOW()
    WHERE created_at IS NULL
  `;
  await sql`
    UPDATE interview_completion_jobs
    SET updated_at = NOW()
    WHERE updated_at IS NULL
  `;
  await sql`
    UPDATE interview_completion_jobs
    SET completed_at = COALESCE(completed_at, updated_at, created_at, NOW())
    WHERE status = 'completed' AND completed_at IS NULL
  `;
  await sql`
    UPDATE interview_completion_jobs
    SET claim_token = NULL, claim_expires_at = NULL
    WHERE status IN ('pending', 'failed', 'completed')
  `;
  await sql`
    UPDATE interview_completion_jobs
    SET status = 'pending', claim_token = NULL, claim_expires_at = NULL, error_json = NULL, updated_at = NOW()
    WHERE status IN ('scoring', 'reporting') AND (claim_token IS NULL OR claim_expires_at IS NULL)
  `;
  await sql`
    ALTER TABLE interview_completion_jobs
      ALTER COLUMN status SET DEFAULT 'pending',
      ALTER COLUMN status SET NOT NULL,
      ALTER COLUMN attempt_count SET DEFAULT 0,
      ALTER COLUMN attempt_count SET NOT NULL,
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT NOW(),
      ALTER COLUMN updated_at SET NOT NULL
  `;
  await sql`ALTER TABLE interview_completion_jobs DROP CONSTRAINT IF EXISTS interview_completion_jobs_status_check`;
  await sql`ALTER TABLE interview_completion_jobs DROP CONSTRAINT IF EXISTS interview_completion_jobs_attempt_count_check`;
  await sql`
    ALTER TABLE interview_completion_jobs
      ADD CONSTRAINT interview_completion_jobs_status_check CHECK (
        (status IN ('scoring', 'reporting') AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
        OR (status IN ('pending', 'failed') AND claim_token IS NULL AND claim_expires_at IS NULL)
        OR (status = 'completed' AND claim_token IS NULL AND claim_expires_at IS NULL AND completed_at IS NOT NULL)
      ),
      ADD CONSTRAINT interview_completion_jobs_attempt_count_check CHECK (attempt_count >= 0)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_completion_jobs_interview
    ON interview_completion_jobs(interview_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_interview_completion_jobs_status_claim
    ON interview_completion_jobs(status, claim_expires_at)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      overall_score INTEGER,
      dimension_averages_json JSONB,
      summary_json JSONB NOT NULL,
      score_status TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE interview_reports
      ADD COLUMN IF NOT EXISTS overall_score INTEGER,
      ADD COLUMN IF NOT EXISTS dimension_averages_json JSONB,
      ADD COLUMN IF NOT EXISTS summary_json JSONB,
      ADD COLUMN IF NOT EXISTS score_status TEXT,
      ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ
  `;
  await sql`
    UPDATE interview_reports
    SET generated_at = NOW()
    WHERE generated_at IS NULL
  `;

  // 1. Sanitize summary_json with reportSummarySchema
  const existingReports = await sql<{ id: string; summary_json: unknown }[]>`
    SELECT id, summary_json FROM interview_reports
  `;
  for (const r of existingReports) {
    const summaryObj =
      typeof r.summary_json === "string"
        ? (() => {
            try {
              return JSON.parse(r.summary_json);
            } catch {
              return null;
            }
          })()
        : r.summary_json;
    const parseResult = reportSummarySchema.safeParse(summaryObj);
    if (!parseResult.success) {
      await sql`
        UPDATE interview_reports
        SET summary_json = ${sql.json(MIGRATION_FALLBACK_REPORT_SUMMARY)}
        WHERE id = ${r.id}
      `;
    }
  }

  // 2. Validate all scored question_scores rows independently
  const allScoredQuestionRows = await sql<{
    id: string;
    understanding: number | null;
    expression: number | null;
    logic: number | null;
    depth: number | null;
    authenticity: number | null;
    reflection: number | null;
    overall: string | number | null;
    feedback_json: unknown;
  }[]>`
    SELECT id, understanding, expression, logic, depth, authenticity, reflection, overall, feedback_json
    FROM question_scores
    WHERE status = 'scored'
  `;

  const inconsistentScoreIds: string[] = [];
  for (const row of allScoredQuestionRows) {
    const scoresObj = {
      understanding: row.understanding,
      expression: row.expression,
      logic: row.logic,
      depth: row.depth,
      authenticity: row.authenticity,
      reflection: row.reflection,
    };
    const parsedScores = questionScoresSchema.safeParse(scoresObj);
    if (!parsedScores.success) {
      inconsistentScoreIds.push(row.id);
      continue;
    }
    const parsedFeedback = questionFeedbackSchema.safeParse(row.feedback_json);
    if (!parsedFeedback.success) {
      inconsistentScoreIds.push(row.id);
      continue;
    }
    const overallValidation = validateQuestionOverall(row.overall, parsedScores.data);
    if (!overallValidation.valid) {
      inconsistentScoreIds.push(row.id);
      continue;
    }
  }

  if (inconsistentScoreIds.length > 0) {
    throw new Error(
      `Inconsistent scored question scores detected (count: ${inconsistentScoreIds.length}). Candidate score data cannot be fabricated.`,
    );
  }

  // 3. Validate consistency of aggregate scores & abort on inconsistent reports
  const allReports = await sql<{
    id: string;
    interview_id: string;
    overall_score: number | null;
    dimension_averages_json: unknown;
    score_status: string | null;
  }[]>`
    SELECT id, interview_id, overall_score, dimension_averages_json, score_status
    FROM interview_reports
  `;

  const inconsistentReportIds: string[] = [];

  for (const rep of allReports) {
    const hasOverall = rep.overall_score !== null && rep.overall_score !== undefined;
    const hasDimensions = rep.dimension_averages_json !== null && rep.dimension_averages_json !== undefined;

    if (hasOverall !== hasDimensions) {
      inconsistentReportIds.push(rep.id);
      continue;
    }

    // Query scorable questions and question scores for this interview
    const scorableQuestions = await sql<{
      question_id: string;
      score_status: string | null;
      understanding: number | null;
      expression: number | null;
      logic: number | null;
      depth: number | null;
      authenticity: number | null;
      reflection: number | null;
      overall: string | number | null;
    }[]>`
      SELECT
        q.id AS question_id,
        qs.status AS score_status,
        qs.understanding,
        qs.expression,
        qs.logic,
        qs.depth,
        qs.authenticity,
        qs.reflection,
        qs.overall
      FROM interview_questions q
      JOIN interview_answers a ON a.question_id = q.id
      LEFT JOIN question_scores qs ON qs.question_id = q.id
      WHERE q.interview_id = ${rep.interview_id}
        AND q.status = 'answered'
        AND a.status = 'answered'
      ORDER BY q.sequence ASC
    `;

    if (scorableQuestions.length > 0) {
      // Must have valid scored row for every scorable question
      const scoredInputs: ScoredQuestionInput[] = [];
      let allQuestionsValid = true;

      for (const sq of scorableQuestions) {
        if (sq.score_status !== "scored") {
          allQuestionsValid = false;
          break;
        }
        const scoreObj = {
          understanding: sq.understanding,
          expression: sq.expression,
          logic: sq.logic,
          depth: sq.depth,
          authenticity: sq.authenticity,
          reflection: sq.reflection,
        };
        const parsedScores = questionScoresSchema.safeParse(scoreObj);
        if (!parsedScores.success) {
          allQuestionsValid = false;
          break;
        }
        const overallValidation = validateQuestionOverall(sq.overall, parsedScores.data);
        if (!overallValidation.valid) {
          allQuestionsValid = false;
          break;
        }
        scoredInputs.push({
          questionId: sq.question_id,
          scores: parsedScores.data,
          questionOverallTenths: overallValidation.questionOverallTenths,
        });
      }

      if (!allQuestionsValid) {
        inconsistentReportIds.push(rep.id);
        continue;
      }

      const expectedAggregate = computeInterviewAggregates(scoredInputs);
      if (expectedAggregate.scoreStatus !== "scored") {
        inconsistentReportIds.push(rep.id);
        continue;
      }

      // Validate report overallScore
      if (rep.overall_score !== expectedAggregate.overallScore) {
        inconsistentReportIds.push(rep.id);
        continue;
      }

      // Validate dimensionAveragesJson against dimensionAveragesSchema
      const dimsObj =
        typeof rep.dimension_averages_json === "string"
          ? (() => {
              try {
                return JSON.parse(rep.dimension_averages_json);
              } catch {
                return null;
              }
            })()
          : rep.dimension_averages_json;
      const parsedDims = dimensionAveragesSchema.safeParse(dimsObj);
      if (!parsedDims.success) {
        inconsistentReportIds.push(rep.id);
        continue;
      }

      // Check exact mathematical agreement for all 6 dimensions
      let dimsMatch = true;
      for (const dim of DIMENSIONS) {
        if (parsedDims.data[dim] !== expectedAggregate.dimensionAverages[dim]) {
          dimsMatch = false;
          break;
        }
      }
      if (!dimsMatch) {
        inconsistentReportIds.push(rep.id);
        continue;
      }

      if (rep.score_status !== null && rep.score_status !== "scored") {
        inconsistentReportIds.push(rep.id);
        continue;
      }
    } else {
      // 0 scorable questions -> must be no_scorable_answers
      if (hasOverall || hasDimensions) {
        inconsistentReportIds.push(rep.id);
        continue;
      }
      if (rep.score_status !== null && rep.score_status !== "no_scorable_answers") {
        inconsistentReportIds.push(rep.id);
        continue;
      }
    }
  }

  if (inconsistentReportIds.length > 0) {
    throw new Error(
      `Migration failed: Inconsistent interview reports detected (count: ${inconsistentReportIds.length}). Candidate score data cannot be fabricated.`,
    );
  }

  // 3. Only backfill score_status for consistent rows where score_status is NULL
  await sql`
    UPDATE interview_reports
    SET score_status = 'scored'
    WHERE score_status IS NULL AND overall_score IS NOT NULL
  `;
  await sql`
    UPDATE interview_reports
    SET score_status = 'no_scorable_answers'
    WHERE score_status IS NULL AND overall_score IS NULL
  `;

  await sql`
    ALTER TABLE interview_reports
      ALTER COLUMN summary_json SET NOT NULL,
      ALTER COLUMN score_status SET NOT NULL,
      ALTER COLUMN generated_at SET DEFAULT NOW(),
      ALTER COLUMN generated_at SET NOT NULL
  `;
  await sql`ALTER TABLE interview_reports DROP CONSTRAINT IF EXISTS interview_reports_score_status_check`;
  await sql`ALTER TABLE interview_reports DROP CONSTRAINT IF EXISTS interview_reports_score_consistency_check`;
  await sql`
    ALTER TABLE interview_reports
      ADD CONSTRAINT interview_reports_score_status_check CHECK (score_status IN ('scored', 'no_scorable_answers')),
      ADD CONSTRAINT interview_reports_score_consistency_check CHECK (
        (score_status = 'scored' AND overall_score IS NOT NULL AND overall_score >= 0 AND overall_score <= 100 AND dimension_averages_json IS NOT NULL)
        OR (score_status = 'no_scorable_answers' AND overall_score IS NULL AND dimension_averages_json IS NULL)
      )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_reports_interview
    ON interview_reports(interview_id)
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

const isDirectRun = process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js");

if (isDirectRun) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is not set");
    process.exit(1);
  }
  const client = postgres(connectionString, { prepare: false });
  migrateDatabase(client)
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.end();
    });
}
