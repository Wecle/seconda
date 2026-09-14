import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { db } from "@/lib/db";

const originalDatabaseUrl = process.env.DATABASE_URL;
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/seconda_test";
}

test("API routes return 401 when unauthorized", async () => {
  const {
    GET: resumeJdGET,
    POST: resumeJdPOST,
  } = await import("@/app/api/resumes/[id]/job-descriptions/route");
  const {
    DELETE: resumeJdDELETE,
  } = await import("@/app/api/resumes/[id]/job-descriptions/[jdId]/route");
  const {
    GET: interviewJdGET,
  } = await import("@/app/api/interviews/[id]/job-description/route");

  const dummyResumeId = randomUUID();
  const dummyJdId = randomUUID();
  const dummyInterviewId = randomUUID();

  // GET /api/resumes/[id]/job-descriptions
  const getReq = new NextRequest(`http://localhost/api/resumes/${dummyResumeId}/job-descriptions`);
  const getRes = await resumeJdGET(getReq, { params: Promise.resolve({ id: dummyResumeId }) });
  assert.equal(getRes.status, 401);
  const getData = await getRes.json();
  assert.equal(getData.error, "Unauthorized");

  // POST /api/resumes/[id]/job-descriptions
  const postReq = new NextRequest(`http://localhost/api/resumes/${dummyResumeId}/job-descriptions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Frontend Engineer Job Description" }),
  });
  const postRes = await resumeJdPOST(postReq, { params: Promise.resolve({ id: dummyResumeId }) });
  assert.equal(postRes.status, 401);
  const postData = await postRes.json();
  assert.equal(postData.error, "Unauthorized");

  // DELETE /api/resumes/[id]/job-descriptions/[jdId]
  const delReq = new NextRequest(`http://localhost/api/resumes/${dummyResumeId}/job-descriptions/${dummyJdId}`, {
    method: "DELETE",
  });
  const delRes = await resumeJdDELETE(delReq, { params: Promise.resolve({ id: dummyResumeId, jdId: dummyJdId }) });
  assert.equal(delRes.status, 401);
  const delData = await delRes.json();
  assert.equal(delData.error, "Unauthorized");

  // GET /api/interviews/[id]/job-description
  const intReq = new NextRequest(`http://localhost/api/interviews/${dummyInterviewId}/job-description`);
  const intRes = await interviewJdGET(intReq, { params: Promise.resolve({ id: dummyInterviewId }) });
  assert.equal(intRes.status, 401);
  const intData = await intRes.json();
  assert.equal(intData.error, "Unauthorized");
});

test("handleListResumeJobDescriptions validates inputs and ownership", async () => {
  const { handleListResumeJobDescriptions } = await import(
    "@/app/api/resumes/[id]/job-descriptions/route"
  );
  const userId = randomUUID();
  const resumeId = randomUUID();

  // 1. Invalid UUID
  const invalidRes = await handleListResumeJobDescriptions({
    resumeId: "invalid-uuid",
    userId,
  });
  assert.equal(invalidRes.status, 404);
  assert.equal(invalidRes.body.error, "Resume not found");

  // 2. Mock database where resume is not found
  const mockDbNotFound = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  } as unknown as typeof db;

  const notFoundRes = await handleListResumeJobDescriptions(
    { resumeId, userId },
    { database: mockDbNotFound },
  );
  assert.equal(notFoundRes.status, 404);
  assert.equal(notFoundRes.body.error, "Resume not found");

  // 3. Mock database where resume is found
  const mockItems = [
    {
      id: randomUUID(),
      resumeId,
      userId,
      title: "Senior Fullstack Engineer",
      company: "Tech Corp",
      sourceType: "pasted",
      rawText: "Job description text",
      parsedJson: { roleTitle: "Senior Fullstack Engineer" },
      createdAt: new Date(),
    },
  ];

  let queryIndex = 0;
  const mockDbSuccess = {
    select: () => ({
      from: () => ({
        where: () => {
          queryIndex++;
          if (queryIndex === 1) {
            return {
              limit: async () => [{ id: resumeId }],
            };
          }
          return {
            orderBy: async () => mockItems,
          };
        },
      }),
    }),
  } as unknown as typeof db;

  const successRes = await handleListResumeJobDescriptions(
    { resumeId, userId },
    { database: mockDbSuccess },
  );
  assert.equal(successRes.status, 200);
  assert.deepEqual(successRes.body.items, mockItems);
});

test("handleCreateResumeJobDescription validates input files and formats", async () => {
  const { handleCreateResumeJobDescription } = await import(
    "@/app/api/resumes/[id]/job-descriptions/route"
  );
  const userId = randomUUID();
  const resumeId = randomUUID();

  const mockDbSuccess = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: resumeId }],
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => [{ id: randomUUID(), ...values }],
      }),
    }),
  } as unknown as typeof db;

  // 1. Missing both file and text
  const missingRes = await handleCreateResumeJobDescription(
    { resumeId, userId },
    { database: mockDbSuccess },
  );
  assert.equal(missingRes.status, 400);
  assert.match(missingRes.body.error, /Either file or text must be provided/);

  // 2. File too large (>1MB)
  const oversizedFileRes = await handleCreateResumeJobDescription(
    {
      resumeId,
      userId,
      file: {
        name: "test.pdf",
        size: 2 * 1024 * 1024,
        type: "application/pdf",
        buffer: Buffer.alloc(10),
      },
    },
    { database: mockDbSuccess },
  );
  assert.equal(oversizedFileRes.status, 400);
  assert.match(oversizedFileRes.body.error, /less than 1MB/);

  // 2b. Text too long (>8000 chars)
  const oversizedTextRes = await handleCreateResumeJobDescription(
    {
      resumeId,
      userId,
      text: "A".repeat(8001),
    },
    { database: mockDbSuccess },
  );
  assert.equal(oversizedTextRes.status, 400);
  assert.match(oversizedTextRes.body.error, /8000 characters limit/);

  // 3. Unsupported file type
  const unsupportedFileRes = await handleCreateResumeJobDescription(
    {
      resumeId,
      userId,
      file: {
        name: "test.exe",
        size: 1024,
        type: "application/x-msdownload",
        buffer: Buffer.alloc(10),
      },
    },
    { database: mockDbSuccess },
  );
  assert.equal(unsupportedFileRes.status, 400);
  assert.match(unsupportedFileRes.body.error, /Unsupported file format/);

  // 4. Valid text creation
  const textRes = await handleCreateResumeJobDescription(
    {
      resumeId,
      userId,
      text: "资深后端开发工程师\n职责：负责高并发系统架构与微服务开发。\n要求：精通 Go/Java，熟悉分布式系统设计。",
      title: "自定义岗位标题",
      company: "Seconda AI",
    },
    { database: mockDbSuccess },
  );
  assert.equal(textRes.status, 201);
  assert.ok(textRes.body.item);
  assert.equal(textRes.body.item.title, "自定义岗位标题");
  assert.equal(textRes.body.item.company, "Seconda AI");
  assert.equal(textRes.body.item.sourceType, "pasted");
});

test("handleDeleteResumeJobDescription verifies ownership and deletes record", async () => {
  const { handleDeleteResumeJobDescription } = await import(
    "@/app/api/resumes/[id]/job-descriptions/[jdId]/route"
  );
  const userId = randomUUID();
  const resumeId = randomUUID();
  const jdId = randomUUID();

  // 1. Invalid UUID
  const invalidRes = await handleDeleteResumeJobDescription({
    resumeId: "bad-id",
    jdId,
    userId,
  });
  assert.equal(invalidRes.status, 404);

  // 2. Resume not owned
  const mockDbNoResume = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  } as unknown as typeof db;
  const noResumeRes = await handleDeleteResumeJobDescription(
    { resumeId, jdId, userId },
    { database: mockDbNoResume },
  );
  assert.equal(noResumeRes.status, 404);
  assert.equal(noResumeRes.body.error, "Resume not found");

  // 3. JD not found under resume
  let selectCall = 0;
  const mockDbNoJd = {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall++;
          if (selectCall === 1) {
            return { limit: async () => [{ id: resumeId }] };
          }
          return { limit: async () => [] };
        },
      }),
    }),
  } as unknown as typeof db;
  const noJdRes = await handleDeleteResumeJobDescription(
    { resumeId, jdId, userId },
    { database: mockDbNoJd },
  );
  assert.equal(noJdRes.status, 404);
  assert.equal(noJdRes.body.error, "Job description not found");

  // 4. Successful deletion and defaultJobDescriptionId cleanup
  let deleted = false;
  let updatedSettings: unknown = null;
  selectCall = 0;
  const mockDbSuccess = {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall++;
          if (selectCall === 1) {
            return {
              limit: async () => [
                {
                  id: resumeId,
                  interviewSettings: {
                    defaultJobDescriptionId: jdId,
                    targetRole: "后端工程师",
                  },
                },
              ],
            };
          }
          return { limit: async () => [{ id: jdId, storedPath: null }] };
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        deleted = true;
      },
    }),
    update: () => ({
      set: (values: { interviewSettings: unknown }) => ({
        where: async () => {
          updatedSettings = values.interviewSettings;
        },
      }),
    }),
  } as unknown as typeof db;
  const successRes = await handleDeleteResumeJobDescription(
    { resumeId, jdId, userId },
    { database: mockDbSuccess },
  );
  assert.equal(successRes.status, 200);
  assert.equal(successRes.body.success, true);
  assert.equal(deleted, true);
  assert.deepEqual(updatedSettings, {
    defaultJobDescriptionId: undefined,
    targetRole: "后端工程师",
  });
});

test("handleGetInterviewJobSnapshot retrieves snapshot or null", async () => {
  const { handleGetInterviewJobSnapshot } = await import(
    "@/app/api/interviews/[id]/job-description/route"
  );
  const userId = randomUUID();
  const interviewId = randomUUID();

  // 1. Invalid UUID
  const invalidRes = await handleGetInterviewJobSnapshot({
    interviewId: "bad-interview-id",
    userId,
  });
  assert.equal(invalidRes.status, 404);
  assert.equal(invalidRes.body.error, "Interview not found");

  // 2. Unowned interview
  const mockDbNoInterview = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  } as unknown as typeof db;
  const noInterviewRes = await handleGetInterviewJobSnapshot(
    { interviewId, userId },
    { database: mockDbNoInterview },
  );
  assert.equal(noInterviewRes.status, 404);
  assert.equal(noInterviewRes.body.error, "Interview not found");

  // 3. Interview owned without snapshot -> returns null snapshot
  let selectCall = 0;
  const mockDbNoSnapshot = {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall++;
          if (selectCall === 1) {
            return { limit: async () => [{ id: interviewId }] };
          }
          return { limit: async () => [] };
        },
      }),
    }),
  } as unknown as typeof db;
  const noSnapshotRes = await handleGetInterviewJobSnapshot(
    { interviewId, userId },
    { database: mockDbNoSnapshot },
  );
  assert.equal(noSnapshotRes.status, 200);
  assert.equal(noSnapshotRes.body.snapshot, null);

  // 4. Interview owned with snapshot -> returns snapshot
  selectCall = 0;
  const mockSnapshot = {
    id: randomUUID(),
    interviewId,
    title: "AI 研发架构师",
    company: "Seconda",
    canonicalText: "岗位详细要求",
  };
  const mockDbWithSnapshot = {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall++;
          if (selectCall === 1) {
            return { limit: async () => [{ id: interviewId }] };
          }
          return { limit: async () => [mockSnapshot] };
        },
      }),
    }),
  } as unknown as typeof db;
  const withSnapshotRes = await handleGetInterviewJobSnapshot(
    { interviewId, userId },
    { database: mockDbWithSnapshot },
  );
  assert.equal(withSnapshotRes.status, 200);
  assert.deepEqual(withSnapshotRes.body.snapshot, mockSnapshot);
});

test("JD API endpoints full database roundtrip", {
  skip: originalDatabaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const { handleListResumeJobDescriptions, handleCreateResumeJobDescription } = await import(
    "@/app/api/resumes/[id]/job-descriptions/route"
  );
  const { handleDeleteResumeJobDescription } = await import(
    "@/app/api/resumes/[id]/job-descriptions/[jdId]/route"
  );
  const { handleGetInterviewJobSnapshot } = await import(
    "@/app/api/interviews/[id]/job-description/route"
  );

  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/lib/db/schema");
  const { users, resumes, interviews, agentSessions } = schema;
  const { insertInterviewJobSnapshot } = await import("./persistence/repository");
  const { eq } = await import("drizzle-orm");

  const client = postgres(originalDatabaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const ownerId = randomUUID();
  const outsiderId = randomUUID();

  await database.insert(users).values([
    { id: ownerId, email: `${ownerId}@example.test` },
    { id: outsiderId, email: `${outsiderId}@example.test` },
  ]);

  try {
    const [resume] = await database
      .insert(resumes)
      .values({ userId: ownerId, title: "Owner Test Resume" })
      .returning();

    // 1. Create a job description
    const createRes = await handleCreateResumeJobDescription(
      {
        resumeId: resume.id,
        userId: ownerId,
        text: "高级系统工程师\n岗位职责：微服务平台建设\n任职要求：深入理解分布式系统与容器化技术",
        title: "高级系统工程师",
        company: "Seconda Infra",
      },
      { database: database as unknown as typeof db },
    );
    assert.equal(createRes.status, 201);
    assert.ok(createRes.body.item);
    const createdJd = createRes.body.item;
    assert.equal(createdJd.title, "高级系统工程师");
    assert.equal(createdJd.company, "Seconda Infra");

    // 2. Outsider cannot list owner's JDs
    const outsiderListRes = await handleListResumeJobDescriptions(
      { resumeId: resume.id, userId: outsiderId },
      { database: database as unknown as typeof db },
    );
    assert.equal(outsiderListRes.status, 404);

    // 3. Owner lists JDs
    const ownerListRes = await handleListResumeJobDescriptions(
      { resumeId: resume.id, userId: ownerId },
      { database: database as unknown as typeof db },
    );
    assert.equal(ownerListRes.status, 200);
    assert.equal(ownerListRes.body.items.length, 1);
    assert.equal(ownerListRes.body.items[0].id, createdJd.id);

    // 4. Create an interview and bind snapshot
    const [agentSession] = await database
      .insert(agentSessions)
      .values({
        userId: ownerId,
        model: "deepseek/deepseek-chat",
        systemPrompt: "test system prompt",
        workspaceRoot: "/test",
      })
      .returning();

    const [interview] = await database
      .insert(interviews)
      .values({
        userId: ownerId,
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: "hash-test",
        agentSessionId: agentSession.id,
        resumeVersionId: randomUUID(),
        language: "zh",
        persona: "standard",
        interviewType: "technical",
        targetLevel: "Senior",
        targetRole: "系统工程师",
        targetRoundCount: 4,
      })
      .returning();

    const snapshot = await insertInterviewJobSnapshot(database as unknown as typeof db, {
      interviewId: interview.id,
      jobDescriptionId: createdJd.id,
      title: createdJd.title,
      company: createdJd.company,
      sourceType: createdJd.sourceType,
      rawText: createdJd.rawText,
      parsedJson: createdJd.parsedJson,
    });

    // 5. Outsider cannot get interview job snapshot
    const outsiderSnapshotRes = await handleGetInterviewJobSnapshot(
      { interviewId: interview.id, userId: outsiderId },
      { database: database as unknown as typeof db },
    );
    assert.equal(outsiderSnapshotRes.status, 404);

    // 6. Owner gets interview job snapshot
    const ownerSnapshotRes = await handleGetInterviewJobSnapshot(
      { interviewId: interview.id, userId: ownerId },
      { database: database as unknown as typeof db },
    );
    assert.equal(ownerSnapshotRes.status, 200);
    assert.ok(ownerSnapshotRes.body.snapshot);
    assert.equal(ownerSnapshotRes.body.snapshot?.id, snapshot.id);

    // 7. Outsider cannot delete owner's JD
    const outsiderDelRes = await handleDeleteResumeJobDescription(
      { resumeId: resume.id, jdId: createdJd.id, userId: outsiderId },
      { database: database as unknown as typeof db },
    );
    assert.equal(outsiderDelRes.status, 404);

    // 8. Owner deletes JD
    const ownerDelRes = await handleDeleteResumeJobDescription(
      { resumeId: resume.id, jdId: createdJd.id, userId: ownerId },
      { database: database as unknown as typeof db },
    );
    assert.equal(ownerDelRes.status, 200);
    assert.equal(ownerDelRes.body.success, true);

    // 9. Owner list is now empty
    const refreshedListRes = await handleListResumeJobDescriptions(
      { resumeId: resume.id, userId: ownerId },
      { database: database as unknown as typeof db },
    );
    assert.equal(refreshedListRes.status, 200);
    assert.equal(refreshedListRes.body.items.length, 0);

    // 10. Immutable interview snapshot persists even after JD deletion
    const refreshedSnapshotRes = await handleGetInterviewJobSnapshot(
      { interviewId: interview.id, userId: ownerId },
      { database: database as unknown as typeof db },
    );
    assert.equal(refreshedSnapshotRes.status, 200);
    assert.equal(refreshedSnapshotRes.body.snapshot?.id, snapshot.id);
  } finally {
    try {
      await database.delete(users).where(eq(users.id, ownerId));
      await database.delete(users).where(eq(users.id, outsiderId));
    } finally {
      await client.end();
    }
  }
});

test.after(async () => {
  const { closeDatabaseConnection } = await import("@/lib/db");
  await closeDatabaseConnection().catch(() => {});
});
