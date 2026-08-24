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
    await sql`ALTER TABLE agent_sessions DROP CONSTRAINT IF EXISTS agent_sessions_capability_workspace_check`;
    await sql`
      ALTER TABLE agent_sessions ADD CONSTRAINT agent_sessions_capability_workspace_check CHECK (
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
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS agent_sessions_capability_immutable ON agent_sessions;
      CREATE TRIGGER agent_sessions_capability_immutable
      BEFORE UPDATE OF capability ON agent_sessions
      FOR EACH ROW EXECUTE FUNCTION reject_agent_session_capability_update();
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
      ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (
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
    console.log("Agent schema migration completed");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

migrateAgentSchema().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
