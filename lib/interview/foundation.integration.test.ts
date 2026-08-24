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
    ];
    const checkRows = await database.execute<{ conname: string }>(sql`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text IN (
          'agent_events', 'interviews', 'interview_resume_snapshots',
          'interview_questions', 'interview_answers', 'interview_agent_runs'
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
    ];
    const indexRows = await database.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN (
          'agent_events', 'interviews', 'interview_resume_snapshots',
          'interview_questions', 'interview_answers', 'interview_agent_runs'
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
