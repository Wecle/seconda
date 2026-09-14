import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  agentSessions,
  interviewJobSnapshots,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
import {
  createInterviewRequestHash,
  createInterviewRequestSchema,
} from "./domain/create-interview";
import { InterviewApplicationError } from "./domain/errors";
import {
  findOwnedJobDescription,
  insertInterviewJobSnapshot,
  insertResumeJobDescription,
  listResumeJobDescriptions,
} from "@/lib/jd/persistence/repository";
import type { ParsedJobDescription } from "@/lib/jd/types";

const databaseUrl = process.env.DATABASE_URL;

const sampleParsedJd: ParsedJobDescription = {
  roleTitle: "资深后端架构师",
  company: "Seconda Tech",
  experienceLevel: "Senior",
  coreResponsibilities: ["负责分布式架构设计", "主导系统高可用建设"],
  mustHaveSkills: ["精通 Go / TypeScript", "深入理解分布式一致性协议"],
  niceToHaveSkills: ["有大型云原生平台建设经验"],
  competencyKeywords: ["分布式架构", "高可用", "PostgreSQL"],
  decodingInsights: {
    verbAutonomyLevel: "lead_own",
    betweenTheLines: ["需要具备架构决策与自主攻坚能力"],
    reverseQuestions: ["团队目前在架构演进化上最大的技术挑战是什么？"],
  },
};

const sampleParsedResume = {
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

async function createResumeFixture(
  database: ReturnType<typeof drizzle<typeof schema>>,
  userId = randomUUID(),
) {
  await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
  const [resume] = await database.insert(resumes).values({ userId, title: "Test Resume" }).returning();
  const [version] = await database.insert(resumeVersions).values({
    resumeId: resume.id,
    versionNumber: 1,
    sourceType: "generated",
    parsedJson: sampleParsedResume,
    parseStatus: "parsed",
  }).returning();
  return { userId, resume, version };
}

async function cleanupUser(database: ReturnType<typeof drizzle<typeof schema>>, userId: string) {
  await database.delete(interviews).where(eq(interviews.userId, userId));
  await database.delete(resumes).where(eq(resumes.userId, userId));
  await database.delete(users).where(eq(users.id, userId));
}

test("createInterviewRequestSchema accepts optional jobDescriptionId", () => {
  const resumeVersionId = randomUUID();
  const jobDescriptionId = randomUUID();
  const reqWithJd = {
    resumeVersionId,
    jobDescriptionId,
    language: "zh" as const,
    persona: "standard" as const,
    interviewType: "technical" as const,
    targetLevel: "Senior" as const,
    targetRole: "后端架构师",
    preference: "",
    preferenceTags: [],
    targetRoundCount: 6,
  };
  const parsed = createInterviewRequestSchema.parse(reqWithJd);
  assert.equal(parsed.jobDescriptionId, jobDescriptionId);

  const reqWithoutJd = { ...reqWithJd, jobDescriptionId: undefined };
  const parsedWithout = createInterviewRequestSchema.parse(reqWithoutJd);
  assert.equal(parsedWithout.jobDescriptionId, undefined);
});

test("createInterviewRequestSchema rejects invalid uuid for jobDescriptionId", () => {
  const invalidReq = {
    resumeVersionId: randomUUID(),
    jobDescriptionId: "not-a-uuid",
    language: "zh" as const,
    persona: "standard" as const,
    interviewType: "technical" as const,
    targetLevel: "Senior" as const,
    targetRole: "后端架构师",
    preference: "",
    preferenceTags: [],
    targetRoundCount: 6,
  };
  assert.throws(() => createInterviewRequestSchema.parse(invalidReq));
});

test("creation request hash differs when jobDescriptionId changes", () => {
  const resumeVersionId = randomUUID();
  const baseReq = {
    resumeVersionId,
    language: "zh" as const,
    persona: "standard" as const,
    interviewType: "technical" as const,
    targetLevel: "Senior" as const,
    targetRole: "后端架构师",
    preference: "",
    preferenceTags: [],
    targetRoundCount: 6,
  };

  const parsedWithoutJd = createInterviewRequestSchema.parse(baseReq);
  const hashWithoutJd = createInterviewRequestHash(parsedWithoutJd);

  const jd1 = randomUUID();
  const jd2 = randomUUID();

  const parsedWithJd1 = createInterviewRequestSchema.parse({
    ...baseReq,
    jobDescriptionId: jd1,
  });
  const hashWithJd1 = createInterviewRequestHash(parsedWithJd1);

  const parsedWithJd2 = createInterviewRequestSchema.parse({
    ...baseReq,
    jobDescriptionId: jd2,
  });
  const hashWithJd2 = createInterviewRequestHash(parsedWithJd2);

  assert.notEqual(hashWithoutJd, hashWithJd1);
  assert.notEqual(hashWithJd1, hashWithJd2);
  assert.notEqual(hashWithoutJd, hashWithJd2);
});

test("createInterview atomically freezes job description snapshot and links jobSnapshotId", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { createInterview } = await import("./application/create-interview");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createResumeFixture(database);

  try {
    const jd = await insertResumeJobDescription(database, {
      resumeId: fixture.resume.id,
      userId: fixture.userId,
      title: "资深后端架构师",
      company: "Seconda Tech",
      sourceType: "pasted",
      rawText: "这是 JD 原始内容",
      parsedJson: sampleParsedJd,
    });
    assert.ok(jd.id);

    const listed = await listResumeJobDescriptions(database, fixture.resume.id, fixture.userId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, jd.id);

    const owned = await findOwnedJobDescription(database, jd.id, fixture.userId);
    assert.ok(owned);
    assert.equal(owned?.id, jd.id);

    const created = await createInterview({
      userId: fixture.userId,
      idempotencyKey: "create-interview-jd-1",
      request: {
        resumeVersionId: fixture.version.id,
        jobDescriptionId: jd.id,
        language: "zh",
        persona: "standard",
        interviewType: "technical",
        targetLevel: "Senior",
        targetRole: "后端架构师",
        preference: "",
        preferenceTags: [],
        targetRoundCount: 6,
      },
    }, {
      database,
      model: "deepseek/deepseek-chat",
    });

    assert.equal(created.replayed, false);
    assert.equal(created.status, "initializing");

    const [interviewRow] = await database
      .select()
      .from(interviews)
      .where(eq(interviews.id, created.interviewId));
    assert.ok(interviewRow.jobSnapshotId);

    const [snapshotRow] = await database
      .select()
      .from(interviewJobSnapshots)
      .where(eq(interviewJobSnapshots.id, interviewRow.jobSnapshotId!));
    assert.ok(snapshotRow);
    assert.equal(snapshotRow.interviewId, created.interviewId);
    assert.equal(snapshotRow.jobDescriptionId, jd.id);
    assert.equal(snapshotRow.title, "资深后端架构师");
    assert.equal(snapshotRow.company, "Seconda Tech");
    assert.match(snapshotRow.canonicalText, /职位：资深后端架构师 \| 公司：Seconda Tech/);
    assert.match(snapshotRow.canonicalText, /1\. 负责分布式架构设计/);
    assert.ok(snapshotRow.contentHash);
  } finally {
    try {
      await cleanupUser(database, fixture.userId);
    } finally {
      await client.end();
    }
  }
});

test("createInterview rejects unowned job description without partial writes", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { createInterview } = await import("./application/create-interview");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const ownerFixture = await createResumeFixture(database);
  const otherFixture = await createResumeFixture(database);

  try {
    const jd = await insertResumeJobDescription(database, {
      resumeId: ownerFixture.resume.id,
      userId: ownerFixture.userId,
      title: "资深后端架构师",
      company: "Seconda Tech",
      sourceType: "pasted",
      rawText: "这是 JD 原始内容",
      parsedJson: sampleParsedJd,
    });

    await assert.rejects(
      createInterview({
        userId: otherFixture.userId,
        idempotencyKey: "create-interview-unowned-jd",
        request: {
          resumeVersionId: otherFixture.version.id,
          jobDescriptionId: jd.id,
          language: "zh",
          persona: "standard",
          interviewType: "technical",
          targetLevel: "Senior",
          targetRole: "后端架构师",
          preference: "",
          preferenceTags: [],
          targetRoundCount: 6,
        },
      }, {
        database,
        model: "deepseek/deepseek-chat",
      }),
      (error) => error instanceof InterviewApplicationError && error.code === "JOB_DESCRIPTION_NOT_FOUND",
    );

    const nonExistentJdId = randomUUID();
    await assert.rejects(
      createInterview({
        userId: ownerFixture.userId,
        idempotencyKey: "create-interview-nonexistent-jd",
        request: {
          resumeVersionId: ownerFixture.version.id,
          jobDescriptionId: nonExistentJdId,
          language: "zh",
          persona: "standard",
          interviewType: "technical",
          targetLevel: "Senior",
          targetRole: "后端架构师",
          preference: "",
          preferenceTags: [],
          targetRoundCount: 6,
        },
      }, {
        database,
        model: "deepseek/deepseek-chat",
      }),
      (error) => error instanceof InterviewApplicationError && error.code === "JOB_DESCRIPTION_NOT_FOUND",
    );
  } finally {
    try {
      await cleanupUser(database, ownerFixture.userId);
      await cleanupUser(database, otherFixture.userId);
    } finally {
      await client.end();
    }
  }
});

test("createInterview without jobDescriptionId preserves backward compatibility", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { createInterview } = await import("./application/create-interview");
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createResumeFixture(database);

  try {
    const created = await createInterview({
      userId: fixture.userId,
      idempotencyKey: "create-interview-no-jd",
      request: {
        resumeVersionId: fixture.version.id,
        language: "zh",
        persona: "standard",
        interviewType: "technical",
        targetLevel: "Senior",
        targetRole: "后端架构师",
        preference: "",
        preferenceTags: [],
        targetRoundCount: 6,
      },
    }, {
      database,
      model: "deepseek/deepseek-chat",
    });

    const [interviewRow] = await database
      .select()
      .from(interviews)
      .where(eq(interviews.id, created.interviewId));
    assert.equal(interviewRow.jobSnapshotId, null);

    const snapshots = await database
      .select()
      .from(interviewJobSnapshots)
      .where(eq(interviewJobSnapshots.interviewId, created.interviewId));
    assert.equal(snapshots.length, 0);
  } finally {
    try {
      await cleanupUser(database, fixture.userId);
    } finally {
      await client.end();
    }
  }
});

test("insertInterviewJobSnapshot generates canonical text and content hash", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const fixture = await createResumeFixture(database);

  try {
    const jd = await insertResumeJobDescription(database, {
      resumeId: fixture.resume.id,
      userId: fixture.userId,
      title: "资深后端架构师",
      company: "Seconda Tech",
      sourceType: "pasted",
      rawText: "这是 JD 原始内容",
      parsedJson: sampleParsedJd,
    });

    const [session] = await database.insert(agentSessions).values({
      userId: fixture.userId,
      title: "Direct Snapshot Interview",
      model: "deepseek/deepseek-chat",
      capability: "interview",
      promptVersion: "interview-agent-v2",
      systemPrompt: "System prompt",
    }).returning();

    const [interview] = await database.insert(interviews).values({
      userId: fixture.userId,
      creationIdempotencyKey: "test-snapshot-direct",
      creationRequestHash: "hash123",
      agentSessionId: session.id,
      resumeVersionId: fixture.version.id,
      language: "zh",
      persona: "standard",
      interviewType: "technical",
      targetLevel: "Senior",
      targetRole: "后端架构师",
      preference: "",
      preferenceTags: [],
      targetRoundCount: 6,
    }).returning();

    const snapshot = await insertInterviewJobSnapshot(database, {
      interviewId: interview.id,
      jobDescriptionId: jd.id,
      title: jd.title,
      company: jd.company,
      sourceType: jd.sourceType,
      rawText: jd.rawText,
      parsedJson: sampleParsedJd,
    });

    assert.ok(snapshot.id);
    assert.equal(snapshot.interviewId, interview.id);
    assert.equal(snapshot.title, "资深后端架构师");
    assert.match(snapshot.canonicalText, /职位：资深后端架构师/);
    assert.ok(snapshot.contentHash);
  } finally {
    try {
      await cleanupUser(database, fixture.userId);
    } finally {
      await client.end();
    }
  }
});

