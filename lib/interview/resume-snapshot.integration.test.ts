import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
  questionScores,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
import { deleteResumePreservingSnapshots } from "./resume-snapshot";

test("source edits and deletions preserve snapshot-backed interview history", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  const { createDrizzleAgentInterviewStore } = await import("./agent/drizzle-store");
  const userId = randomUUID();
  const resumeId = randomUUID();
  const versionIds = [randomUUID(), randomUUID()];
  const interviewKeys = [randomUUID(), randomUUID()];
  const interviewIds: string[] = [];

  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.test` });
    await db.insert(resumes).values({ id: resumeId, userId, title: "Original resume" });
    await db.insert(resumeVersions).values(versionIds.map((id, index) => ({
      id,
      resumeId,
      versionNumber: index + 1,
      originalFilename: `resume-${index + 1}.pdf`,
      storedPath: `https://blob.example/${id}.pdf`,
      mimeType: "application/pdf",
      fileSize: 100 + index,
      extractedText: `original text ${index + 1}`,
      parsedJson: { name: "Candidate", title: `Role ${index + 1}`, skills: ["TypeScript"], experience: [], education: [], projects: [], summary: "" },
      parseStatus: "parsed",
    })));

    const store = createDrizzleAgentInterviewStore(db);
    for (let index = 0; index < versionIds.length; index += 1) {
      const created = await store.createInterview({
        ownerUserId: userId,
        idempotencyKey: interviewKeys[index],
        resumeVersionId: versionIds[index],
        config: { configVersion: 2, language: "zh", persona: "standard", preference: "", preferenceTags: [] },
      });
      interviewIds.push(created.interviewId);
      const [question] = await db.insert(interviewQuestions).values({
        interviewId: created.interviewId,
        questionIndex: 1,
        questionType: "project_deep_dive",
        question: "Describe the project",
        answerText: "A durable answer",
        answeredAt: new Date(),
        scoreStatus: "scored",
      }).returning({ id: interviewQuestions.id });
      await db.insert(questionScores).values({
        questionId: question.id,
        understanding: 8,
        expression: 8,
        logic: 8,
        depth: 8,
        authenticity: 8,
        reflection: 8,
        overall: 8,
      });
      await db.update(interviews).set({ status: "completed", overallScore: 80, reportJson: { summary: "durable" } })
        .where(eq(interviews.id, created.interviewId));
    }

    await db.update(resumes).set({ title: "Edited resume" }).where(eq(resumes.id, resumeId));
    await db.update(resumeVersions).set({ extractedText: "edited text", parsedJson: { name: "Changed" } })
      .where(eq(resumeVersions.id, versionIds[0]));
    const [unchanged] = await db.select().from(interviewResumeSnapshots)
      .where(eq(interviewResumeSnapshots.interviewId, interviewIds[0]));
    assert.equal(unchanged.resumeTitle, "Original resume");
    assert.equal(unchanged.extractedText, "original text 1");

    await db.delete(resumeVersions).where(eq(resumeVersions.id, versionIds[0]));
    await db.delete(resumes).where(eq(resumes.id, resumeId));

    const historicalInterviews = await db.select().from(interviews).where(inArray(interviews.id, interviewIds));
    const historicalSnapshots = await db.select().from(interviewResumeSnapshots).where(inArray(interviewResumeSnapshots.interviewId, interviewIds));
    const historicalQuestions = await db.select().from(interviewQuestions).where(inArray(interviewQuestions.interviewId, interviewIds));
    assert.equal(historicalInterviews.length, 2);
    assert.equal(historicalInterviews.every((interview) => interview.resumeVersionId === null && interview.reportJson !== null), true);
    assert.equal(historicalSnapshots.length, 2);
    assert.equal(historicalQuestions.length, 2);
    const historicalScores = await db.select().from(questionScores).where(inArray(questionScores.questionId, historicalQuestions.map((question) => question.id)));
    assert.equal(historicalScores.length, 2);
  } finally {
    try {
      if (interviewIds.length > 0) await db.delete(interviews).where(inArray(interviews.id, interviewIds));
      await db.delete(resumes).where(eq(resumes.id, resumeId));
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("concurrent interview creation and source deletion never removes a snapshot attachment", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  const { createDrizzleAgentInterviewStore } = await import("./agent/drizzle-store");
  const userId = randomUUID();
  const resumeId = randomUUID();
  const versionId = randomUUID();
  const storedPath = `https://blob.example/${versionId}.pdf`;
  let interviewId: string | null = null;
  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.test` });
    await db.insert(resumes).values({ id: resumeId, userId, title: "Racing resume" });
    await db.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      originalFilename: "resume.pdf",
      storedPath,
      extractedText: "Concurrent snapshot",
      parsedJson: { name: "Candidate", experience: [], education: [], projects: [], skills: [], summary: "" },
      parseStatus: "parsed",
    });
    const store = createDrizzleAgentInterviewStore(db);
    const [creation, deletion] = await Promise.allSettled([
      store.createInterview({
        ownerUserId: userId,
        idempotencyKey: randomUUID(),
        resumeVersionId: versionId,
        config: { configVersion: 2, language: "zh", persona: "standard", preference: "", preferenceTags: [] },
      }),
      deleteResumePreservingSnapshots(db, { resumeId, ownerUserId: userId }),
    ]);
    assert.equal(deletion.status, "fulfilled");
    if (creation.status === "fulfilled") {
      interviewId = creation.value.interviewId;
      assert.deepEqual(deletion.value, []);
      const [snapshot] = await db.select().from(interviewResumeSnapshots)
        .where(eq(interviewResumeSnapshots.interviewId, interviewId));
      assert.equal(snapshot.storedPath, storedPath);
    } else {
      assert.deepEqual(deletion.value, [storedPath]);
    }
  } finally {
    try {
      if (interviewId) await db.delete(interviews).where(eq(interviews.id, interviewId));
      await db.delete(resumes).where(eq(resumes.id, resumeId));
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});
