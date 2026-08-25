import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  agentEvents,
  agentRuns,
  agentSessions,
  interviewAgentRuns,
  interviewResumeSnapshots,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
import {
  buildResumeEvidence,
  createInterviewRequestHash,
  createInterviewRequestSchema,
} from "./domain/create-interview";
import { InterviewApplicationError } from "./domain/errors";
import { buildInterviewSystemPrompt } from "./agent/prompt";

const databaseUrl = process.env.DATABASE_URL;

const parsedResume = {
  name: "Ada Lovelace",
  title: "Software Engineer",
  summary: "Builds reliable systems.",
  contact: { email: "ada@example.test" },
  skills: ["TypeScript", "PostgreSQL"],
  experience: [{
    title: "Senior Engineer",
    company: "Analytical Engines",
    period: "2022-present",
    bullets: ["Reduced processing latency by 40%", "Led a five-person migration"],
  }],
  education: [{
    major: "Computer Science",
    degree: "MSc",
    school: "University of London",
    period: "2020-2022",
  }],
  projects: [{
    name: "Runtime",
    description: "Designed an event-driven runtime.",
    tags: ["agents", "events"],
  }],
};

const request = {
  resumeVersionId: randomUUID(),
  language: "zh" as const,
  persona: "standard" as const,
  interviewType: "mixed" as const,
  targetLevel: "Senior" as const,
  targetRole: "Platform Engineer",
  preference: "Focus on system design",
  preferenceTags: ["resume-grounded", "system-design"],
  targetRoundCount: 6,
};

async function createResumeFixture(
  database: ReturnType<typeof drizzle<typeof schema>>,
  input: { userId?: string; parseStatus?: string; parsedJson?: unknown } = {},
) {
  const userId = input.userId ?? randomUUID();
  if (!input.userId) {
    await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
  }
  const [resume] = await database.insert(resumes).values({ userId, title: "Ada Resume" }).returning();
  const [version] = await database.insert(resumeVersions).values({
    resumeId: resume.id,
    versionNumber: 1,
    sourceType: "generated",
    parsedJson: input.parsedJson ?? parsedResume,
    parseStatus: input.parseStatus ?? "parsed",
  }).returning();
  return { userId, resume, version };
}

async function cleanupUser(database: ReturnType<typeof drizzle<typeof schema>>, userId: string) {
  await database.delete(interviews).where(eq(interviews.userId, userId));
  await database.delete(users).where(eq(users.id, userId));
}

test("creation request normalization and evidence ids are deterministic", () => {
  const normalized = createInterviewRequestSchema.parse({
    ...request,
    targetRole: "  Platform Engineer  ",
    preference: "  Focus on system design  ",
  });
  assert.equal(normalized.targetRole, "Platform Engineer");
  assert.equal(
    createInterviewRequestHash(normalized),
    createInterviewRequestHash({ ...normalized }),
  );
  const first = buildResumeEvidence(parsedResume);
  const second = buildResumeEvidence(structuredClone(parsedResume));
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first).length, 19);
  assert.ok(Object.keys(first).every((id) => /^ev_[a-f0-9]{16}$/.test(id)));
  assert.ok(Object.values(first).some((entry) => entry.path === "experience[0].bullets[0]"));
  assert.ok(Object.values(first).some((entry) => entry.path === "experience[0].company"));
  assert.ok(Object.values(first).some((entry) => entry.path === "skills[0]"));
  assert.ok(Object.values(first).some((entry) => entry.path === "education[0].school"));
  assert.ok(Object.values(first).some((entry) => entry.path === "projects[0].tags[1]"));
});

test("system prompt snapshots only trusted enum configuration", () => {
  const friendlyEnglish = buildInterviewSystemPrompt({
    language: "en",
    persona: "friendly",
    interviewType: "behavioral",
    targetLevel: "Junior",
  });
  const stressfulGerman = buildInterviewSystemPrompt({
    language: "de",
    persona: "stressful",
    interviewType: "technical",
    targetLevel: "Senior",
  });
  assert.match(friendlyEnglish, /必须使用英语/);
  assert.match(friendlyEnglish, /友好、鼓励和耐心/);
  assert.match(stressfulGerman, /必须使用德语/);
  assert.match(stressfulGerman, /高压、简洁和追问导向/);
  assert.match(stressfulGerman, /submit_interview_action/);
  assert.doesNotMatch(stressfulGerman, /ignore previous instructions/i);
});

test("createInterview atomically freezes a parsed resume and is idempotent under replay and concurrency", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { createInterview } = await import("./application/create-interview");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createResumeFixture(database);
  try {
    const creationRequest = { ...request, resumeVersionId: fixture.version.id };
    const created = await createInterview({
      userId: fixture.userId,
      idempotencyKey: "create-interview-1",
      request: creationRequest,
    }, {
      database,
      model: "deepseek/deepseek-chat",
    });
    assert.equal(created.replayed, false);
    assert.equal(created.status, "initializing");
    const replayed = await createInterview({
      userId: fixture.userId,
      idempotencyKey: "create-interview-1",
      request: creationRequest,
    }, {
      database,
    });
    assert.deepEqual(replayed, { ...created, replayed: true });
    await assert.rejects(
      createInterview({
        userId: fixture.userId,
        idempotencyKey: "create-interview-1",
        request: { ...creationRequest, targetRole: "Different Role" },
      }, {
        database,
        model: "deepseek/deepseek-chat",
      }),
      (error) => error instanceof InterviewApplicationError
        && error.code === "INTERVIEW_IDEMPOTENCY_CONFLICT",
    );

    const concurrent = await Promise.all(Array.from({ length: 3 }, () => createInterview({
      userId: fixture.userId,
      idempotencyKey: "create-interview-concurrent",
      request: creationRequest,
    }, {
      database,
      model: "deepseek/deepseek-chat",
    })));
    assert.equal(new Set(concurrent.map((item) => item.interviewId)).size, 1);
    assert.equal(concurrent.filter((item) => !item.replayed).length, 1);

    const conflictingConcurrent = await Promise.allSettled([
      "Role A",
      "Role B",
    ].map((targetRole) => createInterview({
      userId: fixture.userId,
      idempotencyKey: "create-interview-concurrent-conflict",
      request: { ...creationRequest, targetRole },
    }, {
      database,
      model: "deepseek/deepseek-chat",
    })));
    assert.equal(conflictingConcurrent.filter((item) => item.status === "fulfilled").length, 1);
    const conflict = conflictingConcurrent.find((item) => item.status === "rejected");
    assert.ok(conflict?.status === "rejected");
    assert.ok(conflict.reason instanceof InterviewApplicationError);
    assert.equal(conflict.reason.code, "INTERVIEW_IDEMPOTENCY_CONFLICT");

    const createdRows = await database.select().from(interviews)
      .where(eq(interviews.userId, fixture.userId));
    assert.equal(createdRows.length, 3);
    const [session] = await database.select().from(agentSessions)
      .where(eq(agentSessions.id, created.agentSessionId));
    assert.equal(session.capability, "interview");
    assert.equal(session.workspaceRoot, null);
    assert.equal(session.promptVersion, "interview-agent-v1");
    assert.match(session.systemPrompt, /所有候选人可见的问题、提示和结束语必须使用中文/);
    assert.match(session.systemPrompt, /题目深度应匹配 Senior 级别/);
    assert.doesNotMatch(session.systemPrompt, /Platform Engineer/);
    assert.doesNotMatch(session.systemPrompt, /Focus on system design/);
    const [snapshot] = await database.select().from(interviewResumeSnapshots)
      .where(eq(interviewResumeSnapshots.interviewId, created.interviewId));
    assert.equal(snapshot.resumeVersionId, fixture.version.id);
    assert.match(snapshot.canonicalText, /Reduced processing latency by 40%/);
    assert.equal(Object.keys(snapshot.evidenceJson as object).length, 19);
    const [logicalRun] = await database.select().from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.id, created.openingRunId));
    assert.equal(logicalRun.triggerType, "opening");
    assert.equal(logicalRun.status, "queued");
    const [agentRun] = await database.select().from(agentRuns)
      .where(eq(agentRuns.id, created.agentRunId));
    assert.equal(agentRun.status, "queued");
    assert.equal(agentRun.startedAt, null);
    const [event] = await database.select().from(agentEvents)
      .where(and(
        eq(agentEvents.sessionId, created.agentSessionId),
        eq(agentEvents.type, "interview/session_initialized"),
      ));
    assert.equal(event.visibility, "model_and_user");
    assert.equal(event.sequence, 1);
    assert.equal(session.nextEventSequence, 2);
  } finally {
    try {
      await cleanupUser(database, fixture.userId);
    } finally {
      await client.end();
    }
  }
});

test("createInterview rejects unowned, unparsed, and structurally invalid resume versions without partial writes", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { createInterview } = await import("./application/create-interview");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const owner = await createResumeFixture(database);
  const unparsed = await createResumeFixture(database, { userId: owner.userId, parseStatus: "parsing" });
  const invalid = await createResumeFixture(database, { userId: owner.userId, parsedJson: { invalid: true } });
  const otherUserId = randomUUID();
  await database.insert(users).values({ id: otherUserId, email: `${otherUserId}@example.test` });
  try {
    const cases = [
      {
        key: "unowned",
        userId: otherUserId,
        versionId: owner.version.id,
        code: "RESUME_VERSION_NOT_FOUND",
      },
      {
        key: "unparsed",
        userId: owner.userId,
        versionId: unparsed.version.id,
        code: "RESUME_VERSION_NOT_PARSED",
      },
      {
        key: "invalid",
        userId: owner.userId,
        versionId: invalid.version.id,
        code: "RESUME_VERSION_INVALID",
      },
    ] as const;
    for (const item of cases) {
      await assert.rejects(createInterview({
        userId: item.userId,
        idempotencyKey: item.key,
        request: { ...request, resumeVersionId: item.versionId },
      }, {
        database,
        model: "deepseek/deepseek-chat",
      }), (error) => error instanceof InterviewApplicationError && error.code === item.code);
    }
    assert.equal(
      (await database.select().from(interviews).where(eq(interviews.userId, owner.userId))).length,
      0,
    );
    assert.equal(
      (await database.select().from(interviews).where(eq(interviews.userId, otherUserId))).length,
      0,
    );
  } finally {
    try {
      await cleanupUser(database, owner.userId);
      await cleanupUser(database, otherUserId);
    } finally {
      await client.end();
    }
  }
});
