import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL environment variable is not set");

const sql = postgres(connectionString, { prepare: false });

async function migrateAgentSchema() {
  try {
    await sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New agent task',
      model TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      next_event_sequence INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT agent_sessions_status_check CHECK (status IN ('idle', 'running', 'failed'))
    )
  `;
    await sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      max_steps INTEGER NOT NULL,
      input_tokens BIGINT,
      output_tokens BIGINT,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT agent_runs_status_check CHECK (status IN ('running', 'completed', 'failed', 'cancelled'))
    )
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
    console.log("Agent schema migration completed");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

migrateAgentSchema().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
