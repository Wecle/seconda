import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { resumes, resumeVersions, users } from "@/lib/db/schema";
import type { ParsedResume } from "./types";

const parsedResume: ParsedResume = {
  name: "Ada",
  title: "Engineer",
  summary: "Builds reliable systems",
  skills: ["TypeScript"],
  experience: [],
  education: [],
  projects: [],
};

test("concurrent generated resume persistence creates one resume and one version", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const { persistGeneratedResume } = await import("./generated-resume-store");
  const userId = randomUUID();
  const idempotencyKey = randomUUID();

  try {
    await database.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
    });

    const results = await Promise.all(Array.from({ length: 4 }, () =>
      persistGeneratedResume(database, {
        ownerUserId: userId,
        idempotencyKey,
        title: "Engineer",
        parsed: parsedResume,
        extractedText: "Ada\nEngineer\n\nSkills\nTypeScript",
      })));

    assert.equal(new Set(results.map((result) => result.id)).size, 1);
    assert.equal(new Set(results.map((result) => result.versionId)).size, 1);

    const rows = await database.select().from(resumes).where(and(
      eq(resumes.userId, userId),
      eq(resumes.creationIdempotencyKey, idempotencyKey),
    ));
    const versions = await database.select().from(resumeVersions).where(
      eq(resumeVersions.resumeId, results[0].id),
    );

    assert.equal(rows.length, 1);
    assert.equal(versions.length, 1);
    assert.equal(rows[0].currentVersionId, versions[0].id);
    assert.equal(versions[0].sourceType, "generated");
    assert.equal(versions[0].storedPath, null);
    assert.equal(versions[0].originalFilename, null);
    assert.equal(versions[0].mimeType, null);
    assert.equal(versions[0].fileSize, null);
  } finally {
    try {
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("generated resume persistence rolls back the parent row when version creation fails", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const { persistGeneratedResume } = await import("./generated-resume-store");
  const userId = randomUUID();
  const idempotencyKey = randomUUID();
  const invalidParsed = { ...parsedResume } as ParsedResume & { circular?: unknown };
  invalidParsed.circular = invalidParsed;

  try {
    await database.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
    });

    await assert.rejects(() => persistGeneratedResume(database, {
      ownerUserId: userId,
      idempotencyKey,
      title: "Engineer",
      parsed: invalidParsed,
      extractedText: "Ada\nEngineer",
    }));

    const rows = await database.select().from(resumes).where(and(
      eq(resumes.userId, userId),
      eq(resumes.creationIdempotencyKey, idempotencyKey),
    ));
    assert.equal(rows.length, 0);
  } finally {
    try {
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});
