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
      interview_settings JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE resumes
    ADD COLUMN IF NOT EXISTS interview_settings JSONB
  `;

  await sql`
    ALTER TABLE resumes
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS resume_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      extracted_text TEXT,
      parsed_json JSONB,
      parse_status TEXT NOT NULL DEFAULT 'uploaded',
      parse_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resume_version_id UUID NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      type TEXT NOT NULL,
      language TEXT NOT NULL,
      question_count INTEGER NOT NULL,
      persona TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      overall_score INTEGER,
      report_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS config_version INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS creation_idempotency_key TEXT`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS creation_owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS preference TEXT`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS preference_tags JSONB`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS target_role TEXT`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS target_role_status TEXT`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS target_role_confidence TEXT`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS target_role_source_ids JSONB`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS candidate_round_count INTEGER NOT NULL DEFAULT 0`;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_resume_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
      owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      resume_title TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      extracted_text TEXT,
      parsed_json JSONB,
      parse_status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    INSERT INTO interview_resume_snapshots (
      interview_id,
      owner_user_id,
      resume_title,
      version_number,
      original_filename,
      stored_path,
      mime_type,
      file_size,
      extracted_text,
      parsed_json,
      parse_status,
      created_at
    )
    SELECT
      interviews.id,
      resumes.user_id,
      resumes.title,
      resume_versions.version_number,
      resume_versions.original_filename,
      resume_versions.stored_path,
      resume_versions.mime_type,
      resume_versions.file_size,
      resume_versions.extracted_text,
      resume_versions.parsed_json,
      resume_versions.parse_status,
      interviews.created_at
    FROM interviews
    JOIN resume_versions ON resume_versions.id = interviews.resume_version_id
    JOIN resumes ON resumes.id = resume_versions.resume_id
    ON CONFLICT (interview_id) DO NOTHING
  `;
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM interviews
        LEFT JOIN interview_resume_snapshots
          ON interview_resume_snapshots.interview_id = interviews.id
        WHERE interview_resume_snapshots.id IS NULL
      ) THEN
        RAISE EXCEPTION 'Cannot switch interview reads: one or more resume snapshots could not be backfilled';
      END IF;
    END $$
  `;
  await sql`
    UPDATE interviews
    SET creation_owner_user_id = interview_resume_snapshots.owner_user_id
    FROM interview_resume_snapshots
    WHERE interview_resume_snapshots.interview_id = interviews.id
      AND interviews.creation_owner_user_id IS NULL
  `;
  await sql`ALTER TABLE interviews DROP CONSTRAINT IF EXISTS interviews_creation_idempotency_key_unique`;
  await sql`DROP INDEX IF EXISTS idx_interviews_creation_idempotency_key`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_creation_owner_key ON interviews(creation_owner_user_id, creation_idempotency_key) WHERE creation_owner_user_id IS NOT NULL AND creation_idempotency_key IS NOT NULL`;
  await sql`ALTER TABLE interviews ALTER COLUMN resume_version_id DROP NOT NULL`;
  await sql`
    DO $$
    DECLARE
      existing_constraint TEXT;
    BEGIN
      SELECT constraint_row.conname
      INTO existing_constraint
      FROM pg_constraint AS constraint_row
      JOIN pg_attribute AS attribute_row
        ON attribute_row.attrelid = constraint_row.conrelid
       AND attribute_row.attnum = ANY(constraint_row.conkey)
      WHERE constraint_row.conrelid = 'interviews'::regclass
        AND constraint_row.contype = 'f'
        AND attribute_row.attname = 'resume_version_id'
      LIMIT 1;

      IF existing_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE interviews DROP CONSTRAINT %I', existing_constraint);
      END IF;

      ALTER TABLE interviews
        ADD CONSTRAINT interviews_resume_version_id_fkey
        FOREIGN KEY (resume_version_id)
        REFERENCES resume_versions(id)
        ON DELETE SET NULL;
    END $$
  `;
  await sql`
    CREATE OR REPLACE FUNCTION reject_interview_resume_snapshot_update()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'Interview resume snapshots are immutable';
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS interview_resume_snapshots_immutable ON interview_resume_snapshots`;
  await sql`
    CREATE TRIGGER interview_resume_snapshots_immutable
    BEFORE UPDATE ON interview_resume_snapshots
    FOR EACH ROW EXECUTE FUNCTION reject_interview_resume_snapshot_update()
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      question_index INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      topic TEXT,
      question TEXT NOT NULL,
      tip TEXT,
      asked_at TIMESTAMPTZ DEFAULT NOW(),
      answer_text TEXT,
      answered_at TIMESTAMPTZ,
      feedback_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (interview_id, question_index)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_agent_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      exit_reason TEXT,
      model TEXT,
      stream_mode TEXT NOT NULL DEFAULT 'non_streaming',
      turn_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      last_event_sequence INTEGER NOT NULL DEFAULT 0,
      checkpoint_json JSONB,
      error_json JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (interview_id, idempotency_key)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_agent_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES interview_agent_runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (run_id, sequence)
    )
  `;

  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS lease_owner TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS attempt_id TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS provisional_message_id TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS last_provider_progress_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS resume_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS next_resume_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS trigger_json JSONB`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS prompt_template_version TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS cache_epoch INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS context_input_tokens INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS compaction_input_tokens INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS compaction_output_tokens INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS cache_metrics_available INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_agent_events_dedupe ON interview_agent_events(run_id, dedupe_key) WHERE dedupe_key IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_agent_tool_commits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES interview_agent_runs(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      result_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (run_id, tool_call_id)
    )
  `;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS compaction_failure_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS score_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS score_attempt_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS score_error_json JSONB`;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_completion_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `;
  await sql`ALTER TABLE interview_completion_jobs ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_completion_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ`;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_context_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      cache_epoch INTEGER NOT NULL,
      through_message_sequence INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      compaction_level INTEGER NOT NULL,
      summary TEXT NOT NULL,
      snapshot_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (interview_id, cache_epoch)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      run_id UUID REFERENCES interview_agent_runs(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL,
      idempotency_key TEXT,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      question_id UUID REFERENCES interview_questions(id) ON DELETE SET NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (interview_id, sequence),
      UNIQUE (interview_id, idempotency_key)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_answer_assessments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
      answer_message_id UUID NOT NULL UNIQUE REFERENCES interview_messages(id) ON DELETE CASCADE,
      completeness TEXT NOT NULL,
      specificity TEXT NOT NULL,
      evidence_strength TEXT NOT NULL,
      reflection_depth TEXT NOT NULL,
      follow_up_needed INTEGER NOT NULL,
      missing_points JSONB NOT NULL,
      extracted_evidence JSONB NOT NULL,
      public_summary TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS interview_answer_assessment_claims (
      answer_message_id UUID PRIMARY KEY REFERENCES interview_messages(id) ON DELETE CASCADE,
      run_id UUID NOT NULL REFERENCES interview_agent_runs(id) ON DELETE CASCADE,
      lease_owner TEXT NOT NULL,
      lease_generation INTEGER NOT NULL,
      claim_expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_coverage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      resume_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      question_count INTEGER NOT NULL DEFAULT 0,
      depth INTEGER NOT NULL DEFAULT 0,
      evidence_quality INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uncovered',
      last_assessment_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (interview_id, category, topic)
    )
  `;
  await sql`ALTER TABLE interview_coverage ADD COLUMN IF NOT EXISTS last_assessment_id UUID`;

  await sql`
    CREATE TABLE IF NOT EXISTS interview_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id UUID NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
      nonce TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS question_scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id UUID NOT NULL UNIQUE REFERENCES interview_questions(id) ON DELETE CASCADE,
      understanding INTEGER NOT NULL,
      expression INTEGER NOT NULL,
      logic INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      authenticity INTEGER NOT NULL,
      reflection INTEGER NOT NULL,
      overall INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE question_scores ALTER COLUMN overall TYPE NUMERIC(3,1) USING overall::numeric`;
  await sql`
    UPDATE interview_questions
    SET score_status = 'scored'
    WHERE EXISTS (
      SELECT 1 FROM question_scores WHERE question_scores.question_id = interview_questions.id
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS deep_dive_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id UUID NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (question_id, mode)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS deep_dive_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES deep_dive_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_deep_dive_sessions_question ON deep_dive_sessions(question_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_deep_dive_messages_session ON deep_dive_messages(session_id)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_interviews_resume_version ON interviews(resume_version_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_resume_snapshots_owner ON interview_resume_snapshots(owner_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_questions_interview ON interview_questions(interview_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_question_scores_question ON question_scores(question_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_shares_interview ON interview_shares(interview_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_agent_runs_interview ON interview_agent_runs(interview_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_agent_runs_lease ON interview_agent_runs(status, lease_expires_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_agent_events_run ON interview_agent_events(run_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_context_snapshots_interview ON interview_context_snapshots(interview_id, cache_epoch)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_messages_interview ON interview_messages(interview_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_coverage_interview ON interview_coverage(interview_id)`;

  console.log("Database migrated successfully");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
