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
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_questions_interview ON interview_questions(interview_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_question_scores_question ON question_scores(question_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_interview_shares_interview ON interview_shares(interview_id)`;

  console.log("Database migrated successfully");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
