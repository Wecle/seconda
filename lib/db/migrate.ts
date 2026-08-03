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
  await sql`ALTER TABLE resumes ADD COLUMN IF NOT EXISTS creation_idempotency_key TEXT`;
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
      UNIQUE (resume_id, version_number),
      CONSTRAINT resume_versions_source_type_check
        CHECK (source_type IN ('uploaded', 'generated')),
      CONSTRAINT resume_versions_generated_attachment_check
        CHECK (
          source_type <> 'generated'
          OR (original_filename IS NULL AND stored_path IS NULL AND mime_type IS NULL AND file_size IS NULL)
        )
    )
  `;
  await sql`ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS source_type TEXT`;
  await sql`UPDATE resume_versions SET source_type = 'uploaded' WHERE source_type IS NULL`;
  await sql`ALTER TABLE resume_versions ALTER COLUMN source_type SET DEFAULT 'uploaded'`;
  await sql`ALTER TABLE resume_versions ALTER COLUMN source_type SET NOT NULL`;
  await sql`ALTER TABLE resume_versions ALTER COLUMN original_filename DROP NOT NULL`;
  await sql`ALTER TABLE resume_versions ALTER COLUMN stored_path DROP NOT NULL`;
  await sql`ALTER TABLE resume_versions DROP CONSTRAINT IF EXISTS resume_versions_source_type_check`;
  await sql`
    ALTER TABLE resume_versions
    ADD CONSTRAINT resume_versions_source_type_check
    CHECK (source_type IN ('uploaded', 'generated'))
  `;
  await sql`ALTER TABLE resume_versions DROP CONSTRAINT IF EXISTS resume_versions_generated_attachment_check`;
  await sql`
    ALTER TABLE resume_versions
    ADD CONSTRAINT resume_versions_generated_attachment_check
    CHECK (
      source_type <> 'generated'
      OR (original_filename IS NULL AND stored_path IS NULL AND mime_type IS NULL AND file_size IS NULL)
    )
  `;
  await sql.begin(async (transaction) => {
    await transaction.unsafe(
      "LOCK TABLE resume_versions IN SHARE ROW EXCLUSIVE MODE",
    );
    await transaction.unsafe(`
      WITH ranked_versions AS (
        SELECT
          id,
          resume_id,
          version_number,
          created_at,
          ROW_NUMBER() OVER (
            PARTITION BY resume_id, version_number
            ORDER BY created_at, id
          ) AS duplicate_rank,
          MAX(version_number) OVER (PARTITION BY resume_id) AS max_version_number
        FROM resume_versions
      ),
      duplicate_versions AS (
        SELECT
          id,
          max_version_number,
          ROW_NUMBER() OVER (
            PARTITION BY resume_id
            ORDER BY version_number, created_at, id
          ) AS duplicate_offset
        FROM ranked_versions
        WHERE duplicate_rank > 1
      )
      UPDATE resume_versions AS version
      SET version_number =
        duplicate_versions.max_version_number + duplicate_versions.duplicate_offset
      FROM duplicate_versions
      WHERE version.id = duplicate_versions.id
    `);
    await transaction.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_versions_resume_number
      ON resume_versions(resume_id, version_number)
    `);
  });

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
      source_type TEXT NOT NULL DEFAULT 'uploaded',
      original_filename TEXT,
      stored_path TEXT,
      mime_type TEXT,
      file_size INTEGER,
      extracted_text TEXT,
      parsed_json JSONB,
      parse_status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT interview_resume_snapshots_source_type_check
        CHECK (source_type IN ('uploaded', 'generated')),
      CONSTRAINT interview_resume_snapshots_generated_attachment_check
        CHECK (
          source_type <> 'generated'
          OR (original_filename IS NULL AND stored_path IS NULL AND mime_type IS NULL AND file_size IS NULL)
        )
    )
  `;
  await sql.begin(async (transaction) => {
    await transaction.unsafe("DROP TRIGGER IF EXISTS interview_resume_snapshots_immutable ON interview_resume_snapshots");
    await transaction.unsafe("ALTER TABLE interview_resume_snapshots ADD COLUMN IF NOT EXISTS source_type TEXT");
    await transaction.unsafe("UPDATE interview_resume_snapshots SET source_type = 'uploaded' WHERE source_type IS NULL");
    await transaction.unsafe("ALTER TABLE interview_resume_snapshots ALTER COLUMN source_type SET DEFAULT 'uploaded'");
    await transaction.unsafe("ALTER TABLE interview_resume_snapshots ALTER COLUMN source_type SET NOT NULL");
    await transaction.unsafe("ALTER TABLE interview_resume_snapshots ALTER COLUMN original_filename DROP NOT NULL");
    await transaction.unsafe("ALTER TABLE interview_resume_snapshots ALTER COLUMN stored_path DROP NOT NULL");
    await transaction.unsafe("ALTER TABLE interview_resume_snapshots DROP CONSTRAINT IF EXISTS interview_resume_snapshots_source_type_check");
    await transaction.unsafe(`
      ALTER TABLE interview_resume_snapshots
      ADD CONSTRAINT interview_resume_snapshots_source_type_check
      CHECK (source_type IN ('uploaded', 'generated'))
    `);
    await transaction.unsafe("ALTER TABLE interview_resume_snapshots DROP CONSTRAINT IF EXISTS interview_resume_snapshots_generated_attachment_check");
    await transaction.unsafe(`
      ALTER TABLE interview_resume_snapshots
      ADD CONSTRAINT interview_resume_snapshots_generated_attachment_check
      CHECK (
        source_type <> 'generated'
        OR (original_filename IS NULL AND stored_path IS NULL AND mime_type IS NULL AND file_size IS NULL)
      )
    `);
    await transaction.unsafe(`
      CREATE OR REPLACE FUNCTION reject_interview_resume_snapshot_update()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Interview resume snapshots are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await transaction.unsafe(`
      CREATE TRIGGER interview_resume_snapshots_immutable
      BEFORE UPDATE ON interview_resume_snapshots
      FOR EACH ROW EXECUTE FUNCTION reject_interview_resume_snapshot_update()
    `);
  });
  await sql`
    INSERT INTO interview_resume_snapshots (
      interview_id,
      owner_user_id,
      resume_title,
      version_number,
      source_type,
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
      resume_versions.source_type,
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
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'accepted'`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS attempt_id TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS provisional_message_id TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS last_provider_progress_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS resume_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS next_resume_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS trigger_json JSONB`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS authorized_proposal_json JSONB`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS authorized_proposal_hash TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS proposal_authorized_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS response_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS prompt_template_version TEXT`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS cache_epoch INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS context_input_tokens INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS compaction_input_tokens INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS compaction_output_tokens INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_runs ADD COLUMN IF NOT EXISTS cache_metrics_available INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT`;
  await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS attempt_id TEXT`;
  await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS logical_message_id TEXT`;
  await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS visibility TEXT`;
  await sql`
    UPDATE interview_agent_events
    SET visibility = 'public'
    WHERE visibility IS NULL
      AND type IN ('artifact_committed', 'run_completed', 'run_failed')
  `;
  await sql`
    UPDATE interview_agent_events
    SET visibility = 'internal'
    WHERE visibility IS NULL
  `;
  await sql`ALTER TABLE interview_agent_events ALTER COLUMN visibility SET DEFAULT 'internal'`;
  await sql`ALTER TABLE interview_agent_events ALTER COLUMN visibility SET NOT NULL`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'interview_agent_events_visibility_check'
          AND conrelid = 'interview_agent_events'::regclass
      ) THEN
        ALTER TABLE interview_agent_events
          ADD CONSTRAINT interview_agent_events_visibility_check
          CHECK (visibility IN ('public', 'internal'));
      END IF;
    END;
    $$
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_agent_events_dedupe ON interview_agent_events(run_id, dedupe_key) WHERE dedupe_key IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_events_public_replay ON interview_agent_events(run_id, sequence) WHERE visibility = 'public'`;
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
      interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
      agent_run_id UUID REFERENCES interview_agent_runs(id) ON DELETE CASCADE,
      question_id UUID REFERENCES interview_questions(id) ON DELETE CASCADE,
      completion_job_id UUID REFERENCES interview_completion_jobs(id) ON DELETE CASCADE,
      prompt_template_version TEXT,
      error_json JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS operation_key TEXT`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS task TEXT`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running'`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS budget_mode TEXT`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS budget_scope TEXT`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS token_limit BIGINT`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS would_exceed_budget INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS cached_input_tokens BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS cache_write_tokens BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS usage_unavailable_attempts INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS estimated_cost_micros BIGINT`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS unpriced_attempts INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS agent_run_id UUID REFERENCES interview_agent_runs(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS question_id UUID REFERENCES interview_questions(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS completion_job_id UUID REFERENCES interview_completion_jobs(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS prompt_template_version TEXT`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS error_json JSONB`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`ALTER TABLE ai_task_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
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
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS task_run_id UUID REFERENCES ai_task_runs(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS attempt_number INTEGER`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS provider TEXT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS model TEXT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS credential_tier TEXT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running'`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS usage_available INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS cached_input_tokens BIGINT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS cache_write_tokens BIGINT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS input_price_micros_per_million BIGINT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS output_price_micros_per_million BIGINT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS cache_read_price_micros_per_million BIGINT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS cache_write_price_micros_per_million BIGINT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS estimated_cost_micros BIGINT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS first_token_ms INTEGER`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS duration_ms INTEGER`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS error_category TEXT`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS retryable INTEGER`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE ai_task_attempts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('ai_task_runs', 'ai_task_attempts')
          AND column_name IN (
            'token_limit', 'input_tokens', 'output_tokens', 'cached_input_tokens',
            'cache_write_tokens', 'input_price_micros_per_million',
            'output_price_micros_per_million', 'cache_read_price_micros_per_million',
            'cache_write_price_micros_per_million', 'estimated_cost_micros'
          )
          AND data_type <> 'bigint'
      ) THEN
        DROP VIEW IF EXISTS ai_task_daily_summary;
        DROP VIEW IF EXISTS ai_interview_observability;
        DROP VIEW IF EXISTS ai_failure_summary;
        DROP VIEW IF EXISTS ai_slow_operations;
        DROP VIEW IF EXISTS ai_cache_efficiency;
        DROP VIEW IF EXISTS ai_completion_health;

        ALTER TABLE ai_task_runs
          ALTER COLUMN token_limit TYPE BIGINT USING token_limit::bigint,
          ALTER COLUMN input_tokens TYPE BIGINT USING input_tokens::bigint,
          ALTER COLUMN output_tokens TYPE BIGINT USING output_tokens::bigint,
          ALTER COLUMN cached_input_tokens TYPE BIGINT USING cached_input_tokens::bigint,
          ALTER COLUMN cache_write_tokens TYPE BIGINT USING cache_write_tokens::bigint,
          ALTER COLUMN estimated_cost_micros TYPE BIGINT USING estimated_cost_micros::bigint;
        ALTER TABLE ai_task_attempts
          ALTER COLUMN input_tokens TYPE BIGINT USING input_tokens::bigint,
          ALTER COLUMN output_tokens TYPE BIGINT USING output_tokens::bigint,
          ALTER COLUMN cached_input_tokens TYPE BIGINT USING cached_input_tokens::bigint,
          ALTER COLUMN cache_write_tokens TYPE BIGINT USING cache_write_tokens::bigint,
          ALTER COLUMN input_price_micros_per_million TYPE BIGINT USING input_price_micros_per_million::bigint,
          ALTER COLUMN output_price_micros_per_million TYPE BIGINT USING output_price_micros_per_million::bigint,
          ALTER COLUMN cache_read_price_micros_per_million TYPE BIGINT USING cache_read_price_micros_per_million::bigint,
          ALTER COLUMN cache_write_price_micros_per_million TYPE BIGINT USING cache_write_price_micros_per_million::bigint,
          ALTER COLUMN estimated_cost_micros TYPE BIGINT USING estimated_cost_micros::bigint;
      END IF;
    END
    $$
  `;
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM ai_task_runs
        WHERE operation_key IS NULL OR task IS NULL OR status IS NULL OR budget_mode IS NULL
          OR would_exceed_budget IS NULL OR input_tokens IS NULL OR output_tokens IS NULL
          OR cached_input_tokens IS NULL OR cache_write_tokens IS NULL
          OR usage_unavailable_attempts IS NULL OR unpriced_attempts IS NULL
          OR started_at IS NULL OR created_at IS NULL OR updated_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Cannot enforce ai_task_runs required columns: manual repair or removal of incomplete operational telemetry is required';
      END IF;
      IF EXISTS (
        SELECT 1 FROM ai_task_attempts
        WHERE task_run_id IS NULL OR attempt_number IS NULL OR provider IS NULL OR model IS NULL
          OR credential_tier IS NULL OR status IS NULL OR usage_available IS NULL
          OR input_tokens IS NULL OR output_tokens IS NULL OR started_at IS NULL OR created_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Cannot enforce ai_task_attempts required columns: manual repair or removal of incomplete operational telemetry is required';
      END IF;

      ALTER TABLE ai_task_runs
        ALTER COLUMN operation_key SET NOT NULL,
        ALTER COLUMN task SET NOT NULL,
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN budget_mode SET NOT NULL,
        ALTER COLUMN would_exceed_budget SET NOT NULL,
        ALTER COLUMN input_tokens SET NOT NULL,
        ALTER COLUMN output_tokens SET NOT NULL,
        ALTER COLUMN cached_input_tokens SET NOT NULL,
        ALTER COLUMN cache_write_tokens SET NOT NULL,
        ALTER COLUMN usage_unavailable_attempts SET NOT NULL,
        ALTER COLUMN unpriced_attempts SET NOT NULL,
        ALTER COLUMN started_at SET NOT NULL,
        ALTER COLUMN created_at SET NOT NULL,
        ALTER COLUMN updated_at SET NOT NULL;
      ALTER TABLE ai_task_attempts
        ALTER COLUMN task_run_id SET NOT NULL,
        ALTER COLUMN attempt_number SET NOT NULL,
        ALTER COLUMN provider SET NOT NULL,
        ALTER COLUMN model SET NOT NULL,
        ALTER COLUMN credential_tier SET NOT NULL,
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN usage_available SET NOT NULL,
        ALTER COLUMN input_tokens SET NOT NULL,
        ALTER COLUMN output_tokens SET NOT NULL,
        ALTER COLUMN started_at SET NOT NULL,
        ALTER COLUMN created_at SET NOT NULL;
    END
    $$
  `;
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM ai_task_runs
          WHERE token_limit < 0 OR token_limit > 9007199254740991
            OR task NOT IN (
              'resume.parse', 'resume.generate', 'interview.agent', 'context.compact',
              'question.generate', 'question.follow-up', 'answer.score', 'report.generate',
              'coach.generate', 'coach.evaluate'
            )
            OR status NOT IN ('running', 'completed', 'failed', 'budget_exceeded')
            OR budget_mode NOT IN ('off', 'observe', 'enforce')
            OR would_exceed_budget NOT IN (0, 1)
            OR input_tokens < 0 OR input_tokens > 9007199254740991
            OR output_tokens < 0 OR output_tokens > 9007199254740991
            OR cached_input_tokens < 0 OR cached_input_tokens > 9007199254740991
            OR cache_write_tokens < 0 OR cache_write_tokens > 9007199254740991
            OR estimated_cost_micros < 0 OR estimated_cost_micros > 9007199254740991
            OR usage_unavailable_attempts < 0 OR unpriced_attempts < 0
        ) OR EXISTS (
          SELECT 1 FROM ai_task_attempts
          WHERE attempt_number <= 0
            OR provider NOT IN ('deepseek', 'openai', 'zhipu')
            OR credential_tier NOT IN ('fast', 'quality')
            OR status NOT IN ('running', 'completed', 'failed', 'budget_rejected')
            OR usage_available NOT IN (0, 1)
            OR retryable IS NOT NULL AND retryable NOT IN (0, 1)
            OR input_tokens < 0 OR input_tokens > 9007199254740991
            OR output_tokens < 0 OR output_tokens > 9007199254740991
            OR cached_input_tokens < 0 OR cached_input_tokens > 9007199254740991
            OR cache_write_tokens < 0 OR cache_write_tokens > 9007199254740991
            OR input_price_micros_per_million < 0 OR input_price_micros_per_million > 9007199254740991
            OR output_price_micros_per_million < 0 OR output_price_micros_per_million > 9007199254740991
            OR cache_read_price_micros_per_million < 0 OR cache_read_price_micros_per_million > 9007199254740991
            OR cache_write_price_micros_per_million < 0 OR cache_write_price_micros_per_million > 9007199254740991
            OR estimated_cost_micros < 0 OR estimated_cost_micros > 9007199254740991
            OR first_token_ms < 0 OR duration_ms < 0
        ) THEN
          RAISE EXCEPTION 'Cannot install telemetry constraints: manual repair or removal of invalid operational telemetry is required';
        END IF;
      END
      $$
    `);
    await transaction.unsafe("ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_token_limit_check");
    await transaction.unsafe("ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_nonnegative_check");
    await transaction.unsafe("ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_task_check");
    await transaction.unsafe("ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_status_check");
    await transaction.unsafe("ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_budget_mode_check");
    await transaction.unsafe("ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_budget_flag_check");
    await transaction.unsafe("ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_nonnegative_check");
    await transaction.unsafe("ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_status_check");
    await transaction.unsafe("ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_provider_check");
    await transaction.unsafe("ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_credential_tier_check");
    await transaction.unsafe("ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_usage_available_check");
    await transaction.unsafe("ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_retryable_check");
    await transaction.unsafe("ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_positive_number_check");
    await transaction.unsafe(`
      ALTER TABLE ai_task_runs
        ADD CONSTRAINT ai_task_runs_token_limit_check CHECK (
          token_limit IS NULL OR token_limit BETWEEN 0 AND 9007199254740991
        ),
        ADD CONSTRAINT ai_task_runs_nonnegative_check CHECK (
          input_tokens BETWEEN 0 AND 9007199254740991
          AND output_tokens BETWEEN 0 AND 9007199254740991
          AND cached_input_tokens BETWEEN 0 AND 9007199254740991
          AND cache_write_tokens BETWEEN 0 AND 9007199254740991
          AND usage_unavailable_attempts >= 0 AND unpriced_attempts >= 0
          AND (estimated_cost_micros IS NULL OR estimated_cost_micros BETWEEN 0 AND 9007199254740991)
        ),
        ADD CONSTRAINT ai_task_runs_task_check CHECK (task IN (
          'resume.parse', 'resume.generate', 'interview.agent', 'context.compact',
          'question.generate', 'question.follow-up', 'answer.score', 'report.generate',
          'coach.generate', 'coach.evaluate'
        )),
        ADD CONSTRAINT ai_task_runs_status_check CHECK (status IN ('running', 'completed', 'failed', 'budget_exceeded')),
        ADD CONSTRAINT ai_task_runs_budget_mode_check CHECK (budget_mode IN ('off', 'observe', 'enforce')),
        ADD CONSTRAINT ai_task_runs_budget_flag_check CHECK (would_exceed_budget IN (0, 1))
    `);
    await transaction.unsafe(`
      ALTER TABLE ai_task_attempts
        ADD CONSTRAINT ai_task_attempts_nonnegative_check CHECK (
          input_tokens BETWEEN 0 AND 9007199254740991
          AND output_tokens BETWEEN 0 AND 9007199254740991
          AND (cached_input_tokens IS NULL OR cached_input_tokens BETWEEN 0 AND 9007199254740991)
          AND (cache_write_tokens IS NULL OR cache_write_tokens BETWEEN 0 AND 9007199254740991)
          AND (input_price_micros_per_million IS NULL OR input_price_micros_per_million BETWEEN 0 AND 9007199254740991)
          AND (output_price_micros_per_million IS NULL OR output_price_micros_per_million BETWEEN 0 AND 9007199254740991)
          AND (cache_read_price_micros_per_million IS NULL OR cache_read_price_micros_per_million BETWEEN 0 AND 9007199254740991)
          AND (cache_write_price_micros_per_million IS NULL OR cache_write_price_micros_per_million BETWEEN 0 AND 9007199254740991)
          AND (estimated_cost_micros IS NULL OR estimated_cost_micros BETWEEN 0 AND 9007199254740991)
          AND (first_token_ms IS NULL OR first_token_ms >= 0)
          AND (duration_ms IS NULL OR duration_ms >= 0)
        ),
        ADD CONSTRAINT ai_task_attempts_status_check CHECK (status IN ('running', 'completed', 'failed', 'budget_rejected')),
        ADD CONSTRAINT ai_task_attempts_provider_check CHECK (provider IN ('deepseek', 'openai', 'zhipu')),
        ADD CONSTRAINT ai_task_attempts_credential_tier_check CHECK (credential_tier IN ('fast', 'quality')),
        ADD CONSTRAINT ai_task_attempts_usage_available_check CHECK (usage_available IN (0, 1)),
        ADD CONSTRAINT ai_task_attempts_retryable_check CHECK (retryable IS NULL OR retryable IN (0, 1)),
        ADD CONSTRAINT ai_task_attempts_positive_number_check CHECK (attempt_number > 0)
    `);
  });
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
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_runs_task_started ON ai_task_runs(task, started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_runs_status_started ON ai_task_runs(status, started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_runs_budget_scope_started ON ai_task_runs(budget_scope, started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_runs_interview_started ON ai_task_runs(interview_id, started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_runs_agent_run ON ai_task_runs(agent_run_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_runs_question ON ai_task_runs(question_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_runs_completion_job ON ai_task_runs(completion_job_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_task_runs_operation_key ON ai_task_runs(operation_key)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_task_attempts_run_number ON ai_task_attempts(task_run_id, attempt_number)`;
  await sql`ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_operation_key_key`;
  await sql`ALTER TABLE ai_task_attempts DROP CONSTRAINT IF EXISTS ai_task_attempts_task_run_id_attempt_number_key`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_attempts_model_started ON ai_task_attempts(model, started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_task_attempts_status_started ON ai_task_attempts(status, started_at)`;

  await sql`
    CREATE OR REPLACE VIEW ai_task_daily_summary AS
    WITH task_metrics AS (
      SELECT
        date_trunc('day', runs.started_at) AS day,
        runs.task,
        first_attempt.provider,
        first_attempt.model,
        COUNT(*)::bigint AS task_count,
        COUNT(*) FILTER (WHERE runs.status = 'completed')::bigint AS success_count,
        COUNT(*) FILTER (WHERE runs.status IN ('failed', 'budget_exceeded'))::bigint AS failure_count
      FROM ai_task_runs AS runs
      LEFT JOIN LATERAL (
        SELECT attempts.provider, attempts.model
        FROM ai_task_attempts AS attempts
        WHERE attempts.task_run_id = runs.id
        ORDER BY attempts.attempt_number, attempts.id
        LIMIT 1
      ) AS first_attempt ON TRUE
      GROUP BY date_trunc('day', runs.started_at), runs.task, first_attempt.provider, first_attempt.model
    ), attempt_metrics AS (
      SELECT
        date_trunc('day', attempts.started_at) AS day,
        runs.task,
        attempts.provider,
        attempts.model,
        COUNT(*)::bigint AS attempt_count,
        COUNT(*) FILTER (WHERE attempts.attempt_number > 1)::bigint AS fallback_count,
        SUM(attempts.input_tokens) FILTER (WHERE attempts.usage_available = 1)::bigint AS input_tokens,
        SUM(attempts.output_tokens) FILTER (WHERE attempts.usage_available = 1)::bigint AS output_tokens,
        SUM(attempts.cached_input_tokens) FILTER (
          WHERE attempts.usage_available = 1 AND attempts.cached_input_tokens IS NOT NULL
        )::bigint AS cached_input_tokens,
        SUM(attempts.cache_write_tokens) FILTER (
          WHERE attempts.usage_available = 1 AND attempts.cache_write_tokens IS NOT NULL
        )::bigint AS cache_write_tokens,
        SUM(attempts.estimated_cost_micros)::numeric AS known_cost_micros,
        COUNT(*) FILTER (
          WHERE attempts.status IN ('completed', 'failed')
            AND attempts.usage_available = 1
            AND (
              attempts.input_price_micros_per_million IS NULL
              OR attempts.output_price_micros_per_million IS NULL
              OR (attempts.cached_input_tokens IS NOT NULL AND attempts.cache_read_price_micros_per_million IS NULL)
              OR (attempts.cache_write_tokens IS NOT NULL AND attempts.cache_write_price_micros_per_million IS NULL)
            )
        )::bigint AS unpriced_attempts,
        COUNT(*) FILTER (
          WHERE attempts.status IN ('completed', 'failed') AND attempts.usage_available = 0
        )::bigint AS usage_unavailable_attempts,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY attempts.duration_ms)
          FILTER (WHERE attempts.duration_ms IS NOT NULL) AS duration_p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY attempts.duration_ms)
          FILTER (WHERE attempts.duration_ms IS NOT NULL) AS duration_p95_ms
      FROM ai_task_attempts AS attempts
      JOIN ai_task_runs AS runs ON runs.id = attempts.task_run_id
      GROUP BY date_trunc('day', attempts.started_at), runs.task, attempts.provider, attempts.model
    )
    SELECT
      COALESCE(task_metrics.day, attempt_metrics.day) AS day,
      COALESCE(task_metrics.task, attempt_metrics.task) AS task,
      COALESCE(task_metrics.provider, attempt_metrics.provider) AS provider,
      COALESCE(task_metrics.model, attempt_metrics.model) AS model,
      COALESCE(task_metrics.task_count, 0)::bigint AS task_count,
      COALESCE(attempt_metrics.attempt_count, 0)::bigint AS attempt_count,
      COALESCE(task_metrics.success_count, 0)::bigint AS success_count,
      COALESCE(task_metrics.failure_count, 0)::bigint AS failure_count,
      COALESCE(attempt_metrics.fallback_count, 0)::bigint AS fallback_count,
      attempt_metrics.input_tokens,
      attempt_metrics.output_tokens,
      attempt_metrics.cached_input_tokens,
      attempt_metrics.cache_write_tokens,
      attempt_metrics.known_cost_micros,
      attempt_metrics.unpriced_attempts,
      attempt_metrics.usage_unavailable_attempts,
      attempt_metrics.duration_p50_ms,
      attempt_metrics.duration_p95_ms
    FROM task_metrics
    FULL OUTER JOIN attempt_metrics
      ON attempt_metrics.day = task_metrics.day
      AND attempt_metrics.task = task_metrics.task
      AND attempt_metrics.provider IS NOT DISTINCT FROM task_metrics.provider
      AND attempt_metrics.model IS NOT DISTINCT FROM task_metrics.model
  `;

  await sql`
    CREATE OR REPLACE VIEW ai_interview_observability AS
    WITH task_metrics AS (
      SELECT
        interview_id,
        COUNT(DISTINCT agent_run_id) FILTER (WHERE task = 'interview.agent' AND agent_run_id IS NOT NULL)::bigint AS agent_run_count,
        COUNT(DISTINCT agent_run_id) FILTER (
          WHERE task = 'interview.agent' AND agent_run_id IS NOT NULL AND status IN ('failed', 'budget_exceeded')
        )::bigint AS failed_agent_run_count,
        MIN(started_at) AS earliest_task_at,
        MAX(COALESCE(completed_at, started_at)) AS latest_task_at
      FROM ai_task_runs
      WHERE interview_id IS NOT NULL
      GROUP BY interview_id
    ), attempt_metrics AS (
      SELECT
        runs.interview_id,
        COUNT(attempts.id) FILTER (WHERE attempts.attempt_number > 1)::bigint AS retry_fallback_count,
        SUM(attempts.input_tokens) FILTER (WHERE attempts.usage_available = 1)::bigint AS input_tokens,
        SUM(attempts.output_tokens) FILTER (WHERE attempts.usage_available = 1)::bigint AS output_tokens,
        SUM(attempts.cached_input_tokens) FILTER (
          WHERE attempts.usage_available = 1 AND attempts.cached_input_tokens IS NOT NULL
        )::bigint AS cached_input_tokens,
        SUM(attempts.cache_write_tokens) FILTER (
          WHERE attempts.usage_available = 1 AND attempts.cache_write_tokens IS NOT NULL
        )::bigint AS cache_write_tokens,
        SUM(attempts.estimated_cost_micros)::numeric AS known_cost_micros,
        COUNT(attempts.id) FILTER (
          WHERE attempts.status IN ('completed', 'failed')
            AND attempts.usage_available = 1
            AND (
              attempts.input_price_micros_per_million IS NULL
              OR attempts.output_price_micros_per_million IS NULL
              OR (attempts.cached_input_tokens IS NOT NULL AND attempts.cache_read_price_micros_per_million IS NULL)
              OR (attempts.cache_write_tokens IS NOT NULL AND attempts.cache_write_price_micros_per_million IS NULL)
            )
        )::bigint AS unpriced_attempts,
        COUNT(attempts.id) FILTER (
          WHERE attempts.status IN ('completed', 'failed') AND attempts.usage_available = 0
        )::bigint AS usage_unavailable_attempts
      FROM ai_task_runs AS runs
      JOIN ai_task_attempts AS attempts ON attempts.task_run_id = runs.id
      WHERE runs.interview_id IS NOT NULL
      GROUP BY runs.interview_id
    ), recovery_metrics AS (
      SELECT interview_id, SUM(resume_count)::bigint AS recovery_count
      FROM interview_agent_runs
      GROUP BY interview_id
    ), completion_metrics AS (
      SELECT
        interview_id,
        CASE
          WHEN completed_at IS NULL THEN NULL
          ELSE FLOOR(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)::bigint
        END AS completion_latency_ms
      FROM interview_completion_jobs
    )
    SELECT
      interviews.id AS interview_id,
      task_metrics.agent_run_count,
      task_metrics.failed_agent_run_count,
      attempt_metrics.retry_fallback_count,
      recovery_metrics.recovery_count,
      attempt_metrics.input_tokens,
      attempt_metrics.output_tokens,
      attempt_metrics.cached_input_tokens,
      attempt_metrics.cache_write_tokens,
      attempt_metrics.known_cost_micros,
      attempt_metrics.unpriced_attempts,
      attempt_metrics.usage_unavailable_attempts,
      task_metrics.earliest_task_at,
      task_metrics.latest_task_at,
      completion_metrics.completion_latency_ms
    FROM interviews
    LEFT JOIN task_metrics ON task_metrics.interview_id = interviews.id
    LEFT JOIN attempt_metrics ON attempt_metrics.interview_id = interviews.id
    LEFT JOIN recovery_metrics ON recovery_metrics.interview_id = interviews.id
    LEFT JOIN completion_metrics ON completion_metrics.interview_id = interviews.id
  `;

  await sql`
    CREATE OR REPLACE VIEW ai_failure_summary AS
    SELECT
      date_trunc('day', attempts.started_at) AS day,
      runs.task,
      attempts.provider,
      attempts.model,
      attempts.status,
      attempts.error_category,
      attempts.retryable,
      (attempts.status = 'budget_rejected') AS budget_rejection,
      COUNT(*)::bigint AS failure_count
    FROM ai_task_attempts AS attempts
    JOIN ai_task_runs AS runs ON runs.id = attempts.task_run_id
    WHERE attempts.status IN ('failed', 'budget_rejected')
    GROUP BY
      date_trunc('day', attempts.started_at), runs.task, attempts.provider, attempts.model,
      attempts.status, attempts.error_category, attempts.retryable, (attempts.status = 'budget_rejected')
  `;

  await sql`
    CREATE OR REPLACE VIEW ai_slow_operations AS
    SELECT
      runs.id AS task_run_id,
      attempts.id AS attempt_id,
      runs.interview_id,
      runs.agent_run_id,
      runs.question_id,
      runs.completion_job_id,
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

  await sql`
    CREATE OR REPLACE VIEW ai_cache_efficiency AS
    SELECT
      date_trunc('day', attempts.started_at) AS day,
      runs.task,
      attempts.model,
      runs.prompt_template_version,
      COUNT(*) FILTER (
        WHERE attempts.status IN ('completed', 'failed') AND attempts.cached_input_tokens IS NOT NULL
      )::bigint AS available_sample_count,
      COUNT(*) FILTER (
        WHERE attempts.status IN ('completed', 'failed') AND attempts.cached_input_tokens IS NULL
      )::bigint AS unavailable_sample_count,
      SUM(attempts.input_tokens) FILTER (
        WHERE attempts.usage_available = 1 AND attempts.cached_input_tokens IS NOT NULL
      )::bigint AS input_tokens,
      SUM(attempts.cached_input_tokens) FILTER (
        WHERE attempts.usage_available = 1 AND attempts.cached_input_tokens IS NOT NULL
      )::bigint AS cache_read_tokens,
      SUM(attempts.cache_write_tokens) FILTER (
        WHERE attempts.usage_available = 1 AND attempts.cache_write_tokens IS NOT NULL
      )::bigint AS cache_write_tokens,
      SUM(attempts.cached_input_tokens) FILTER (
        WHERE attempts.usage_available = 1 AND attempts.cached_input_tokens IS NOT NULL
      )::numeric
        / NULLIF(SUM(attempts.input_tokens) FILTER (
          WHERE attempts.usage_available = 1 AND attempts.cached_input_tokens IS NOT NULL
        ), 0) AS cache_read_ratio
    FROM ai_task_attempts AS attempts
    JOIN ai_task_runs AS runs ON runs.id = attempts.task_run_id
    GROUP BY date_trunc('day', attempts.started_at), runs.task, attempts.model, runs.prompt_template_version
  `;

  await sql`
    CREATE OR REPLACE VIEW ai_completion_health AS
    WITH question_metrics AS (
      SELECT
        jobs.id AS completion_job_id,
        COUNT(questions.id) FILTER (WHERE questions.answer_text IS NOT NULL)::bigint AS questions_requiring_scores,
        COUNT(scores.id)::bigint AS scored_questions,
        COUNT(questions.id) FILTER (WHERE questions.score_status = 'failed')::bigint AS failed_questions
      FROM interview_completion_jobs AS jobs
      LEFT JOIN interview_questions AS questions ON questions.interview_id = jobs.interview_id
      LEFT JOIN question_scores AS scores ON scores.question_id = questions.id
      GROUP BY jobs.id
    ), task_metrics AS (
      SELECT
        runs.completion_job_id,
        runs.task,
        SUM(attempts.input_tokens) FILTER (WHERE attempts.usage_available = 1)::bigint AS input_tokens,
        SUM(attempts.output_tokens) FILTER (WHERE attempts.usage_available = 1)::bigint AS output_tokens,
        SUM(attempts.estimated_cost_micros)::numeric AS known_cost_micros,
        COUNT(attempts.id) FILTER (
          WHERE attempts.status IN ('completed', 'failed')
            AND attempts.usage_available = 1
            AND (
              attempts.input_price_micros_per_million IS NULL
              OR attempts.output_price_micros_per_million IS NULL
              OR (attempts.cached_input_tokens IS NOT NULL AND attempts.cache_read_price_micros_per_million IS NULL)
              OR (attempts.cache_write_tokens IS NOT NULL AND attempts.cache_write_price_micros_per_million IS NULL)
            )
        )::bigint AS unpriced_attempts,
        COUNT(attempts.id) FILTER (
          WHERE attempts.status IN ('completed', 'failed') AND attempts.usage_available = 0
        )::bigint AS usage_unavailable_attempts
      FROM ai_task_runs AS runs
      JOIN ai_task_attempts AS attempts ON attempts.task_run_id = runs.id
      WHERE runs.completion_job_id IS NOT NULL AND runs.task IN ('answer.score', 'report.generate')
      GROUP BY runs.completion_job_id, runs.task
    )
    SELECT
      jobs.id AS completion_job_id,
      jobs.interview_id,
      jobs.status,
      jobs.attempt_count AS execution_attempts,
      question_metrics.questions_requiring_scores,
      question_metrics.scored_questions,
      question_metrics.failed_questions,
      score_metrics.input_tokens AS score_input_tokens,
      score_metrics.output_tokens AS score_output_tokens,
      score_metrics.known_cost_micros AS score_known_cost_micros,
      score_metrics.unpriced_attempts AS score_unpriced_attempts,
      score_metrics.usage_unavailable_attempts AS score_usage_unavailable_attempts,
      report_metrics.input_tokens AS report_input_tokens,
      report_metrics.output_tokens AS report_output_tokens,
      report_metrics.known_cost_micros AS report_known_cost_micros,
      report_metrics.unpriced_attempts AS report_unpriced_attempts,
      report_metrics.usage_unavailable_attempts AS report_usage_unavailable_attempts,
      jobs.created_at AS started_at,
      jobs.completed_at,
      CASE
        WHEN jobs.completed_at IS NULL THEN NULL
        ELSE FLOOR(EXTRACT(EPOCH FROM (jobs.completed_at - jobs.created_at)) * 1000)::bigint
      END AS duration_ms
    FROM interview_completion_jobs AS jobs
    JOIN question_metrics ON question_metrics.completion_job_id = jobs.id
    LEFT JOIN task_metrics AS score_metrics
      ON score_metrics.completion_job_id = jobs.id AND score_metrics.task = 'answer.score'
    LEFT JOIN task_metrics AS report_metrics
      ON report_metrics.completion_job_id = jobs.id AND report_metrics.task = 'report.generate'
  `;

  console.log("Database migrated successfully");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
