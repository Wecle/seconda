import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  agentEvents,
  agentSessions,
  interviewAgentRuns,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";

const databaseUrl = process.env.DATABASE_URL;

async function createFoundationFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const userId = randomUUID();
  await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
  const [resume] = await database.insert(resumes).values({ userId, title: "Foundation Resume" }).returning();
  const [version] = await database.insert(resumeVersions).values({
    resumeId: resume.id,
    versionNumber: 1,
    sourceType: "generated",
    parsedJson: { name: "Candidate", skills: [], experience: [] },
    parseStatus: "parsed",
  }).returning();
  const [session] = await database.insert(agentSessions).values({
    userId,
    title: "Interview foundation",
    model: "deepseek/deepseek-chat",
    capability: "interview",
    promptVersion: "interview-agent-v1",
    systemPrompt: "Interview contract",
    workspaceRoot: null,
  }).returning();
  return { userId, resume, version, session };
}

test("interview foundation enforces creation uniqueness, one awaiting question, and immutable snapshots", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createFoundationFixture(database);
  try {
    const [interview] = await database.insert(interviews).values({
      userId: fixture.userId,
      creationIdempotencyKey: "create-1",
      creationRequestHash: "hash-1",
      agentSessionId: fixture.session.id,
      resumeVersionId: fixture.version.id,
      language: "zh",
      persona: "standard",
      interviewType: "mixed",
      targetLevel: "Mid",
      targetRole: "Software Engineer",
      preferenceTags: ["resume-grounded"],
      targetRoundCount: 5,
    }).returning();
    const [otherSession] = await database.insert(agentSessions).values({
      userId: fixture.userId,
      title: "Duplicate creation key",
      model: "deepseek/deepseek-chat",
      capability: "interview",
      promptVersion: "interview-agent-v1",
      systemPrompt: "Interview contract",
      workspaceRoot: null,
    }).returning();
    await assert.rejects(database.insert(interviews).values({
      userId: fixture.userId,
      creationIdempotencyKey: "create-1",
      creationRequestHash: "different-hash",
      agentSessionId: otherSession.id,
      resumeVersionId: fixture.version.id,
      language: "zh",
      persona: "standard",
      interviewType: "mixed",
      targetLevel: "Mid",
      targetRole: "Software Engineer",
      targetRoundCount: 5,
    }));
    const [snapshot] = await database.insert(interviewResumeSnapshots).values({
      interviewId: interview.id,
      resumeId: fixture.resume.id,
      resumeVersionId: fixture.version.id,
      resumeTitle: fixture.resume.title,
      versionNumber: fixture.version.versionNumber,
      sourceType: fixture.version.sourceType,
      parsedJson: fixture.version.parsedJson!,
      canonicalText: "Candidate",
      evidenceJson: { "experience[0]": "Candidate" },
      contentHash: "content-hash",
    }).returning();
    await assert.rejects(
      database.update(interviewResumeSnapshots)
        .set({ canonicalText: "mutated" })
        .where(eq(interviewResumeSnapshots.id, snapshot.id)),
    );
    const [openingRun] = await database.insert(interviewAgentRuns).values({
      interviewId: interview.id,
      triggerType: "opening",
      triggerKey: "opening",
    }).returning();
    await database.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: openingRun.id,
      sequence: 1,
      kind: "main",
      topic: "experience",
      question: "Tell me about your experience.",
    });
    const [retryRun] = await database.insert(interviewAgentRuns).values({
      interviewId: interview.id,
      triggerType: "opening",
      triggerKey: "opening-retry",
    }).returning();
    await assert.rejects(database.insert(interviewQuestions).values({
      interviewId: interview.id,
      sourceInterviewRunId: retryRun.id,
      sequence: 2,
      kind: "main",
      topic: "projects",
      question: "Tell me about a project.",
    }));
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("migration installs every foundation constraint and preserves data across reruns", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createFoundationFixture(database);
  try {
    const [sentinel] = await database.insert(interviews).values({
      userId: fixture.userId,
      creationIdempotencyKey: "migration-sentinel",
      creationRequestHash: "migration-sentinel-hash",
      agentSessionId: fixture.session.id,
      resumeVersionId: fixture.version.id,
      language: "en",
      persona: "friendly",
      interviewType: "behavioral",
      targetLevel: "Senior",
      targetRole: "Engineering Manager",
      preferenceTags: ["leadership"],
      targetRoundCount: 8,
    }).returning();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      execFileSync("pnpm", ["exec", "tsx", "lib/db/migrate.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl! },
        stdio: "pipe",
      });
    }
    const [retained] = await database.select({ id: interviews.id }).from(interviews)
      .where(eq(interviews.id, sentinel.id));
    assert.equal(retained.id, sentinel.id);

    const expectedChecks = [
      "agent_events_schema_version_check",
      "agent_events_visibility_check",
      "interviews_status_check",
      "interviews_language_check",
      "interviews_persona_check",
      "interviews_type_check",
      "interviews_target_level_check",
      "interviews_target_round_count_check",
      "interviews_answered_round_count_check",
      "interviews_version_check",
      "interviews_preference_tags_check",
      "interview_resume_snapshots_version_check",
      "interview_resume_snapshots_source_type_check",
      "interview_questions_sequence_check",
      "interview_questions_kind_check",
      "interview_questions_status_check",
      "interview_questions_evidence_check",
      "interview_answers_status_check",
      "interview_answers_content_check",
      "interview_agent_runs_trigger_type_check",
      "interview_agent_runs_status_check",
      "interview_agent_runs_attempt_count_check",
      "interview_agent_runs_generation_check",
      "interview_agent_runs_trigger_answer_check",
      "question_scores_status_check",
      "question_scores_attempt_count_check",
      "question_scores_overall_check",
      "question_scores_dimension_bounds_check",
      "interview_completion_jobs_status_check",
      "interview_completion_jobs_attempt_count_check",
      "interview_reports_score_status_check",
      "interview_reports_score_consistency_check",
    ];
    const checkRows = await database.execute<{ conname: string }>(sql`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text IN (
          'agent_events', 'interviews', 'interview_resume_snapshots',
          'interview_questions', 'interview_answers', 'interview_agent_runs',
          'question_scores', 'interview_completion_jobs', 'interview_reports'
        )
    `);
    assert.deepEqual(
      [...checkRows].map((row) => row.conname).sort(),
      [...expectedChecks].sort(),
    );

    const expectedIndexes = [
      "idx_agent_events_session_dedupe_key",
      "idx_interviews_owner_creation_key",
      "idx_interviews_agent_session",
      "idx_interview_resume_snapshots_interview",
      "idx_interview_questions_sequence",
      "idx_interview_questions_source_run",
      "idx_interview_questions_one_awaiting",
      "idx_interview_answers_question",
      "idx_interview_answers_submission_key",
      "idx_interview_agent_runs_trigger",
      "idx_interview_agent_runs_current_agent_run",
      "idx_question_scores_question",
      "idx_interview_completion_jobs_interview",
      "idx_interview_reports_interview",
    ];
    const indexRows = await database.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN (
          'agent_events', 'interviews', 'interview_resume_snapshots',
          'interview_questions', 'interview_answers', 'interview_agent_runs',
          'question_scores', 'interview_completion_jobs', 'interview_reports'
        )
    `);
    assert.deepEqual(
      [...indexRows].map((row) => row.indexname).filter((name) => expectedIndexes.includes(name)).sort(),
      [...expectedIndexes].sort(),
    );
    const auditLinks = await database.execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN (
        'interview_questions_source_interview_run_id_fkey',
        'interview_answers_question_id_fkey',
        'interview_agent_runs_trigger_answer_fk'
      )
    `);
    assert.equal(auditLinks.length, 3);
    assert.ok([...auditLinks].every((row) => row.definition.includes("ON DELETE RESTRICT")));
  } finally {
    try {
      await database.delete(interviews).where(eq(interviews.userId, fixture.userId));
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("transaction-bound event append commits and rolls back with domain writes", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { appendAgentEventsInTransaction } = await import("@/lib/agent/repository");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createFoundationFixture(database);
  try {
    await assert.rejects(database.transaction(async (transaction) => {
      await appendAgentEventsInTransaction(transaction, {
        sessionId: fixture.session.id,
        events: [{
          type: "interview/session_initialized",
          payload: { interviewId: "rolled-back" },
          dedupeKey: "interview:session:rolled-back",
          visibility: "model_and_user",
        }],
      });
      throw new Error("rollback domain transaction");
    }));
    assert.equal(
      (await database.select().from(agentEvents).where(eq(agentEvents.sessionId, fixture.session.id))).length,
      0,
    );
    const [event] = await database.transaction((transaction) => appendAgentEventsInTransaction(transaction, {
      sessionId: fixture.session.id,
      events: [{
        type: "interview/session_initialized",
        payload: { interviewId: "committed" },
        dedupeKey: "interview:session:committed",
        schemaVersion: 1,
        visibility: "model_and_user",
      }],
    }));
    assert.equal(event.sequence, 1);
    assert.equal(event.visibility, "model_and_user");
    const batch = await database.transaction((transaction) => appendAgentEventsInTransaction(transaction, {
      sessionId: fixture.session.id,
      events: [
        { type: "interview/question_committed", payload: { questionId: "q1" } },
        { type: "interview/answer_submitted", payload: { answerId: "a1" } },
      ],
    }));
    assert.deepEqual(batch.map((item) => item.sequence), [2, 3]);
    const concurrent = await Promise.all(["left", "right"].map((side) =>
      database.transaction((transaction) => appendAgentEventsInTransaction(transaction, {
        sessionId: fixture.session.id,
        events: [{ type: "interview/answer_analyzed", payload: { side } }],
      })),
    ));
    assert.deepEqual(concurrent.flat().map((item) => item.sequence).sort((a, b) => a - b), [4, 5]);
    await assert.rejects(database.transaction((transaction) => appendAgentEventsInTransaction(transaction, {
      sessionId: fixture.session.id,
      events: [{
        type: "interview/session_initialized",
        payload: { interviewId: "duplicate" },
        dedupeKey: "interview:session:committed",
      }],
    })));
    const [session] = await database.select().from(agentSessions)
      .where(eq(agentSessions.id, fixture.session.id));
    assert.equal(session.nextEventSequence, 6);
  } finally {
    try {
      await database.delete(users).where(eq(users.id, fixture.userId));
    } finally {
      await client.end();
    }
  }
});

test("migration converges legacy and corrupted active states safely in isolated schema", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { migrateDatabase } = await import("@/lib/db/migrate");
  const rawClient = postgres(databaseUrl!, { prepare: false });
  const schemaName = `migration_test_${randomUUID().replace(/-/g, "")}`;

  try {
    // 1. Create isolated temporary schema
    await rawClient.unsafe(`CREATE SCHEMA ${schemaName}`);
    const testUrl = new URL(databaseUrl!);
    testUrl.searchParams.set("options", `-csearch_path=${schemaName}`);
    const client = postgres(testUrl.toString(), { prepare: false });

    try {
      // 2. Run initial full migration into the isolated schema
      await migrateDatabase(client);

      // 3. Populate foundation fixtures in the isolated schema
      const userId = randomUUID();
      await client`INSERT INTO users (id, email) VALUES (${userId}, ${`${userId}@test.com`})`;
      const resumeId = randomUUID();
      await client`INSERT INTO resumes (id, user_id, title) VALUES (${resumeId}, ${userId}, 'Test Resume')`;
      const versionId = randomUUID();
      await client`
        INSERT INTO resume_versions (id, resume_id, version_number, source_type, parse_status)
        VALUES (${versionId}, ${resumeId}, 1, 'generated', 'parsed')
      `;
      const session1 = randomUUID();
      const session2 = randomUUID();
      const session3 = randomUUID();
      const session4 = randomUUID();
      for (const sId of [session1, session2, session3, session4]) {
        await client`
          INSERT INTO agent_sessions (id, user_id, title, model, capability, prompt_version, system_prompt, workspace_root)
          VALUES (${sId}, ${userId}, 'Test Session', 'deepseek', 'interview', 'interview-agent-v1', 'sys', NULL)
        `;
      }
      const interviewId1 = randomUUID();
      const interviewId2 = randomUUID();
      const interviewId3 = randomUUID();
      const interviewId4 = randomUUID();

      for (const [id, key, sId] of [
        [interviewId1, "int-1", session1],
        [interviewId2, "int-2", session2],
        [interviewId3, "int-3", session3],
        [interviewId4, "int-4", session4],
      ] as const) {
        await client`
          INSERT INTO interviews (
            id, user_id, creation_idempotency_key, creation_request_hash, agent_session_id, resume_version_id,
            language, persona, interview_type, target_level, target_role, target_round_count, status
          ) VALUES (
            ${id}, ${userId}, ${key}, ${`hash-${key}`}, ${sId}, ${versionId},
            'zh', 'standard', 'technical', 'Senior', 'Engineer', 3, 'completing'
          )
        `;
      }

      const runId1 = randomUUID();
      const runId4 = randomUUID();
      await client`
        INSERT INTO interview_agent_runs (id, interview_id, trigger_type, trigger_key)
        VALUES (${runId1}, ${interviewId1}, 'opening', 'open-1')
      `;
      await client`
        INSERT INTO interview_agent_runs (id, interview_id, trigger_type, trigger_key)
        VALUES (${runId4}, ${interviewId4}, 'opening', 'open-4')
      `;
      const q1 = randomUUID();
      const q2 = randomUUID();
      await client`
        INSERT INTO interview_questions (id, interview_id, source_interview_run_id, sequence, kind, topic, question, status)
        VALUES (${q1}, ${interviewId4}, ${runId4}, 1, 'main', 'topic', 'question', 'answered')
      `;
      await client`
        INSERT INTO interview_answers (id, interview_id, question_id, submission_key, submission_request_hash, content, status)
        VALUES (${randomUUID()}, ${interviewId4}, ${q1}, 'sub-1', 'hash-1', 'My detailed answer', 'answered')
      `;
      await client`
        INSERT INTO interview_questions (id, interview_id, source_interview_run_id, sequence, kind, topic, question, status)
        VALUES (${q2}, ${interviewId1}, ${runId1}, 2, 'main', 'topic', 'question 2', 'answered')
      `;

      // 4. Simulate missing columns / legacy corrupted active states in isolated schema:
      // Drop new columns from question_scores, interview_completion_jobs, interview_reports
      await client`ALTER TABLE question_scores DROP CONSTRAINT IF EXISTS question_scores_status_check`;
      await client`ALTER TABLE question_scores DROP CONSTRAINT IF EXISTS question_scores_scored_check`;
      await client`ALTER TABLE question_scores DROP COLUMN IF EXISTS claim_token`;
      await client`ALTER TABLE question_scores DROP COLUMN IF EXISTS claim_expires_at`;
      await client`ALTER TABLE question_scores DROP COLUMN IF EXISTS error_json`;
      await client`ALTER TABLE question_scores ALTER COLUMN status DROP NOT NULL`;
      await client`ALTER TABLE question_scores ALTER COLUMN status DROP DEFAULT`;
      await client`ALTER TABLE question_scores ALTER COLUMN attempt_count DROP NOT NULL`;
      await client`ALTER TABLE question_scores ALTER COLUMN attempt_count DROP DEFAULT`;

      await client`ALTER TABLE interview_completion_jobs DROP CONSTRAINT IF EXISTS interview_completion_jobs_status_check`;
      await client`ALTER TABLE interview_completion_jobs DROP COLUMN IF EXISTS claim_token`;
      await client`ALTER TABLE interview_completion_jobs DROP COLUMN IF EXISTS claim_expires_at`;
      await client`ALTER TABLE interview_completion_jobs DROP COLUMN IF EXISTS error_json`;
      await client`ALTER TABLE interview_completion_jobs ALTER COLUMN status DROP NOT NULL`;
      await client`ALTER TABLE interview_completion_jobs ALTER COLUMN status DROP DEFAULT`;
      await client`ALTER TABLE interview_completion_jobs ALTER COLUMN attempt_count DROP NOT NULL`;
      await client`ALTER TABLE interview_completion_jobs ALTER COLUMN attempt_count DROP DEFAULT`;

      await client`ALTER TABLE interview_reports DROP CONSTRAINT IF EXISTS interview_reports_score_status_check`;
      await client`ALTER TABLE interview_reports DROP CONSTRAINT IF EXISTS interview_reports_score_consistency_check`;
      await client`ALTER TABLE interview_reports ALTER COLUMN summary_json DROP NOT NULL`;
      await client`ALTER TABLE interview_reports ALTER COLUMN score_status DROP NOT NULL`;

      // Insert scenario 1: question_scores scored with attempt_count
      const score1 = randomUUID();
      await client`
        INSERT INTO question_scores (id, question_id, understanding, expression, logic, depth, authenticity, reflection, overall, feedback_json, status, attempt_count)
        VALUES (${score1}, ${q1}, 8, 8, 8, 8, 8, 8, 8.0, '{"strengths":["ok"],"improvements":["more"],"advice":"practice"}'::jsonb, 'scored', 2)
      `;

      // Insert scenario 2: question_scores legacy active 'scoring' without claim columns
      const score2 = randomUUID();
      await client`
        INSERT INTO question_scores (id, question_id, status, attempt_count)
        VALUES (${score2}, ${q2}, 'scoring', 1)
      `;

      // Insert scenario 3: interview_completion_jobs legacy 'scoring' without claim columns
      const job1 = randomUUID();
      await client`
        INSERT INTO interview_completion_jobs (id, interview_id, status, attempt_count)
        VALUES (${job1}, ${interviewId1}, 'scoring', 1)
      `;

      // Insert scenario 4: interview_completion_jobs legacy 'reporting' without claim columns
      const job2 = randomUUID();
      await client`
        INSERT INTO interview_completion_jobs (id, interview_id, status, attempt_count)
        VALUES (${job2}, ${interviewId2}, 'reporting', 1)
      `;

      // Insert scenario 5: completed job missing completed_at
      const job3 = randomUUID();
      await client`
        INSERT INTO interview_completion_jobs (id, interview_id, status, attempt_count)
        VALUES (${job3}, ${interviewId3}, 'completed', 1)
      `;

      // Insert scenario 6a: report with null summary_json and missing score_status (consistent scored with interviewId4 / score1)
      const report1 = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json)
        VALUES (${report1}, ${interviewId4}, 80, '{"understanding":8.0,"expression":8.0,"logic":8.0,"depth":8.0,"authenticity":8.0,"reflection":8.0}'::jsonb)
      `;

      // Insert scenario 6b: report with valid summary and missing score_status (consistent no_scorable_answers on interviewId1)
      const report2 = randomUUID();
      const validSummary = {
        overallSummary: "A factual overview of the interview session.",
        keyStrengths: ["Demonstrated solid core understanding"],
        keyImprovements: ["Could structure answers with STAR method"],
        recommendations: "Practice system design fundamentals.",
      };
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json)
        VALUES (${report2}, ${interviewId1}, NULL, NULL, ${JSON.stringify(validSummary)}::jsonb)
      `;

      // Insert scenario 6c: report with malformed non-null summary_json ({}) on interviewId2
      const report3 = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json)
        VALUES (${report3}, ${interviewId2}, NULL, NULL, '{}'::jsonb)
      `;

      // Insert scenario 6d: report with malformed non-null summary_json (keyStrengths as string) on interviewId3
      const report4 = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json)
        VALUES (${report4}, ${interviewId3}, NULL, NULL, '{"overallSummary":"foo","keyStrengths":"not-an-array","keyImprovements":["bar"],"recommendations":"baz"}'::jsonb)
      `;

      // 5. Run migration to converge
      await migrateDatabase(client);

      // 6. Verify information_schema for nullable, default, types
      const qsCols = await client<{ column_name: string; is_nullable: string; column_default: string }[]>`
        SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = 'question_scores'
      `;
      const qsColMap = new Map(qsCols.map((c) => [c.column_name, c]));
      assert.equal(qsColMap.get("status")?.is_nullable, "NO");
      assert.ok(qsColMap.get("status")?.column_default?.includes("pending"));
      assert.equal(qsColMap.get("attempt_count")?.is_nullable, "NO");
      assert.ok(qsColMap.get("attempt_count")?.column_default?.includes("0"));
      assert.equal(qsColMap.get("created_at")?.is_nullable, "NO");
      assert.equal(qsColMap.get("updated_at")?.is_nullable, "NO");
      assert.ok(qsColMap.has("claim_token"));
      assert.ok(qsColMap.has("claim_expires_at"));
      assert.ok(qsColMap.has("error_json"));

      const jobCols = await client<{ column_name: string; is_nullable: string; column_default: string }[]>`
        SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = 'interview_completion_jobs'
      `;
      const jobColMap = new Map(jobCols.map((c) => [c.column_name, c]));
      assert.equal(jobColMap.get("status")?.is_nullable, "NO");
      assert.ok(jobColMap.get("status")?.column_default?.includes("pending"));
      assert.equal(jobColMap.get("attempt_count")?.is_nullable, "NO");
      assert.ok(jobColMap.get("attempt_count")?.column_default?.includes("0"));
      assert.equal(jobColMap.get("created_at")?.is_nullable, "NO");
      assert.equal(jobColMap.get("updated_at")?.is_nullable, "NO");

      const repCols = await client<{ column_name: string; is_nullable: string; column_default: string }[]>`
        SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = 'interview_reports'
      `;
      const repColMap = new Map(repCols.map((c) => [c.column_name, c]));
      assert.equal(repColMap.get("summary_json")?.is_nullable, "NO");
      assert.equal(repColMap.get("score_status")?.is_nullable, "NO");
      assert.equal(repColMap.get("generated_at")?.is_nullable, "NO");

      // 7. Verify data normalization and retention:
      // Score 1 (scored) preserved
      const [scoredRow] = await client<{ status: string; understanding: number; attempt_count: number }[]>`
        SELECT status, understanding, attempt_count FROM question_scores WHERE id = ${score1}
      `;
      assert.equal(scoredRow.status, "scored");
      assert.equal(scoredRow.understanding, 8);
      assert.equal(scoredRow.attempt_count, 2);

      // Score 2 (legacy scoring without claim) normalized to pending
      const [scoringRow] = await client<{ status: string; claim_token: string | null; claim_expires_at: string | null }[]>`
        SELECT status, claim_token, claim_expires_at FROM question_scores WHERE id = ${score2}
      `;
      assert.equal(scoringRow.status, "pending");
      assert.equal(scoringRow.claim_token, null);
      assert.equal(scoringRow.claim_expires_at, null);

      // Job 1 & 2 (legacy scoring & reporting without claim) normalized to pending
      const [normJob1] = await client<{ status: string; claim_token: string | null }[]>`
        SELECT status, claim_token FROM interview_completion_jobs WHERE id = ${job1}
      `;
      assert.equal(normJob1.status, "pending");
      assert.equal(normJob1.claim_token, null);

      const [normJob2] = await client<{ status: string; claim_token: string | null }[]>`
        SELECT status, claim_token FROM interview_completion_jobs WHERE id = ${job2}
      `;
      assert.equal(normJob2.status, "pending");
      assert.equal(normJob2.claim_token, null);

      // Job 3 (completed) has completed_at backfilled
      const [normJob3] = await client<{ status: string; completed_at: Date | null }[]>`
        SELECT status, completed_at FROM interview_completion_jobs WHERE id = ${job3}
      `;
      assert.equal(normJob3.status, "completed");
      assert.ok(normJob3.completed_at !== null);

      // Helper to safely inspect summary_json
      const toObj = (val: unknown) => (typeof val === "string" ? JSON.parse(val) : val);

      // Report 1: overall_score (80) and dimensions preserved, score_status backfilled to 'scored', summary backfilled to safe fallback
      const [normRep1] = await client<{ score_status: string; overall_score: number; summary_json: Record<string, unknown> }[]>`
        SELECT score_status, overall_score, summary_json FROM interview_reports WHERE id = ${report1}
      `;
      assert.equal(normRep1.score_status, "scored");
      assert.equal(normRep1.overall_score, 80);
      assert.equal(toObj(normRep1.summary_json).overallSummary, "Historical report summary is unavailable.");

      // Report 2: null scores preserved, score_status backfilled to 'no_scorable_answers', valid summary preserved unchanged
      const [normRep2] = await client<{ score_status: string; overall_score: number | null; summary_json: Record<string, unknown> }[]>`
        SELECT score_status, overall_score, summary_json FROM interview_reports WHERE id = ${report2}
      `;
      assert.equal(normRep2.score_status, "no_scorable_answers");
      assert.equal(normRep2.overall_score, null);
      assert.deepEqual(toObj(normRep2.summary_json), validSummary);

      // Report 3 & 4: malformed summary_json replaced with safe fallback satisfying schema
      const { reportSummarySchema } = await import("@/lib/interview/domain/scoring");
      const [normRep3] = await client<{ summary_json: Record<string, unknown> }[]>`
        SELECT summary_json FROM interview_reports WHERE id = ${report3}
      `;
      assert.doesNotThrow(() => reportSummarySchema.parse(toObj(normRep3.summary_json)));
      assert.equal(toObj(normRep3.summary_json).overallSummary, "Historical report summary is unavailable.");

      const [normRep4] = await client<{ summary_json: Record<string, unknown> }[]>`
        SELECT summary_json FROM interview_reports WHERE id = ${report4}
      `;
      assert.doesNotThrow(() => reportSummarySchema.parse(toObj(normRep4.summary_json)));
      assert.equal(toObj(normRep4.summary_json).overallSummary, "Historical report summary is unavailable.");

      // 8. Test that inconsistent reports fail migration and prove transactional rollback
      // Clean up previous reports to prepare isolated failure tests
      await client`DELETE FROM interview_reports`;
      await client`ALTER TABLE interview_reports DROP CONSTRAINT IF EXISTS interview_reports_score_consistency_check`;
      await client`ALTER TABLE interview_reports DROP CONSTRAINT IF EXISTS interview_reports_score_status_check`;
      await client`ALTER TABLE interview_reports ALTER COLUMN score_status DROP NOT NULL`;

      // Test inconsistent case 1: Mathematical mismatch between report and question scores
      // interviewId4 has question score 8 (recomputes to overall 80, dimensions 8.0), but report claims overall 100 with dimensions 0
      const badReportMath = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json, score_status)
        VALUES (${badReportMath}, ${interviewId4}, 100, '{"understanding":0,"expression":0,"logic":0,"depth":0,"authenticity":0,"reflection":0}'::jsonb, ${JSON.stringify(validSummary)}::jsonb, NULL)
      `;

      // Insert a sentinel report with malformed summary_json on interviewId2.
      // Migration Step 1 modifies malformed summary_json to fallback.
      // Migration Step 2 detects inconsistent report on interviewId4 and aborts.
      // If transactional rollback works, Step 1's modification MUST be rolled back!
      const sentinelMalformedRep = randomUUID();
      const malformedSentinel = { sentinel: "should_not_be_overwritten" };
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json, score_status)
        VALUES (${sentinelMalformedRep}, ${interviewId2}, NULL, NULL, ${JSON.stringify(malformedSentinel)}::jsonb, NULL)
      `;

      // Also insert a legitimate unmigrated report with score_status = NULL on interviewId1
      const preMigratedRep = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json, score_status)
        VALUES (${preMigratedRep}, ${interviewId1}, NULL, NULL, ${JSON.stringify(validSummary)}::jsonb, NULL)
      `;

      // Attempt migration -> must throw and rollback!
      await assert.rejects(
        () => migrateDatabase(client),
        /Inconsistent interview reports detected/,
      );

      // PROVE TRANSACTIONAL ROLLBACK:
      // 1. summary_json on sentinelMalformedRep was NOT overwritten with fallback (Step 1 was rolled back)
      const [rolledBackSentinel] = await client<{ summary_json: Record<string, unknown> }[]>`
        SELECT summary_json FROM interview_reports WHERE id = ${sentinelMalformedRep}
      `;
      assert.deepEqual(toObj(rolledBackSentinel.summary_json), malformedSentinel);

      // 2. score_status on preMigratedRep was NOT backfilled (still NULL)
      const [rolledBackRep] = await client<{ score_status: string | null }[]>`
        SELECT score_status FROM interview_reports WHERE id = ${preMigratedRep}
      `;
      assert.equal(rolledBackRep.score_status, null);

      // 3. CHECK constraint was NOT installed
      const [constraintRow] = await client<{ constraint_name: string }[]>`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = ${schemaName}
          AND table_name = 'interview_reports'
          AND constraint_name = 'interview_reports_score_consistency_check'
      `;
      assert.equal(constraintRow, undefined);

      // Clean up bad report and sentinel
      await client`DELETE FROM interview_reports WHERE id = ${badReportMath}`;
      await client`DELETE FROM interview_reports WHERE id = ${sentinelMalformedRep}`;

      // Test inconsistent case 1b: Scored question overall contradicts its 6-dimension scores WITHOUT any report existing
      // (6 dimensions all 8, but question_scores.overall = 9.0 on an interview with 0 reports)
      await client`
        UPDATE question_scores
        SET overall = 9.0
        WHERE question_id = ${q1}
      `;
      await assert.rejects(
        () => migrateDatabase(client),
        /Inconsistent scored question scores detected/,
      );
      // Restore q1 score overall
      await client`
        UPDATE question_scores
        SET overall = 8.0
        WHERE question_id = ${q1}
      `;

      // Test inconsistent case 2: overall_score exists, dimension_averages_json is NULL
      const badReport1 = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json, score_status)
        VALUES (${badReport1}, ${interviewId4}, 90, NULL, ${JSON.stringify(validSummary)}::jsonb, 'scored')
      `;
      await assert.rejects(
        () => migrateDatabase(client),
        /Inconsistent interview reports detected/,
      );
      await client`DELETE FROM interview_reports WHERE id = ${badReport1}`;

      // Test inconsistent case 3: overall_score is NULL, dimension_averages_json exists
      const badReport2 = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json, score_status)
        VALUES (${badReport2}, ${interviewId4}, NULL, '{"understanding":8.0,"expression":8.0,"logic":8.0,"depth":8.0,"authenticity":8.0,"reflection":8.0}'::jsonb, ${JSON.stringify(validSummary)}::jsonb, 'no_scorable_answers')
      `;
      await assert.rejects(
        () => migrateDatabase(client),
        /Inconsistent interview reports detected/,
      );
      await client`DELETE FROM interview_reports WHERE id = ${badReport2}`;

      // Test inconsistent case 4: dimension averages have invalid precision (>1 decimal place)
      const badReport3 = randomUUID();
      await client`
        INSERT INTO interview_reports (id, interview_id, overall_score, dimension_averages_json, summary_json, score_status)
        VALUES (${badReport3}, ${interviewId4}, 80, '{"understanding":8.55,"expression":8.0,"logic":8.0,"depth":8.0,"authenticity":8.0,"reflection":8.0}'::jsonb, ${JSON.stringify(validSummary)}::jsonb, 'scored')
      `;
      await assert.rejects(
        () => migrateDatabase(client),
        /Inconsistent interview reports detected/,
      );
      await client`DELETE FROM interview_reports WHERE id = ${badReport3}`;

      // 9. Run migration on clean data to verify successful convergence and idempotency
      await migrateDatabase(client);

      const [finalRep] = await client<{ score_status: string | null }[]>`
        SELECT score_status FROM interview_reports WHERE id = ${preMigratedRep}
      `;
      assert.equal(finalRep.score_status, "no_scorable_answers");

      // Verify constraint is now installed
      const [finalConstraint] = await client<{ constraint_name: string }[]>`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = ${schemaName}
          AND table_name = 'interview_reports'
          AND constraint_name = 'interview_reports_score_consistency_check'
      `;
      assert.ok(finalConstraint !== undefined);

      // 9. Run migration second time to verify idempotency on clean data
      await migrateDatabase(client);

      const [scoreAfter2] = await client<{ status: string; understanding: number }[]>`
        SELECT status, understanding FROM question_scores WHERE id = ${score1}
      `;
      assert.equal(scoreAfter2.status, "scored");
      assert.equal(scoreAfter2.understanding, 8);
    } finally {
      await client.end();
    }
  } finally {
    await rawClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await rawClient.end();
  }
});
