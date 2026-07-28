import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { resumes, resumeVersions, users } from "@/lib/db/schema";
import { serializeParsedResume } from "./canonical-text";
import {
  editResumeVersion,
  ResumeEditError,
} from "./edit-resume-version";
import type { ParsedResume, ResumeSourceType } from "./types";

const databaseAvailable = process.env.DATABASE_URL
  ? false
  : "DATABASE_URL is not configured";

const originalParsed: ParsedResume = {
  name: "Candidate",
  title: "Engineer",
  summary: "",
  skills: ["TypeScript"],
  experience: [],
  education: [],
  projects: [],
};

const editedParsed: ParsedResume = {
  ...originalParsed,
  summary: "Builds reliable systems",
  skills: ["TypeScript", "PostgreSQL"],
};

async function createSource(input: {
  database: ReturnType<typeof drizzle<typeof schema>>;
  userId: string;
  sourceType: ResumeSourceType;
  attachmentComplete?: boolean;
}) {
  const resumeId = randomUUID();
  const versionId = randomUUID();
  const attachmentComplete = input.attachmentComplete ?? true;
  await input.database.insert(resumes).values({
    id: resumeId,
    userId: input.userId,
    title: "Engineer",
    currentVersionId: versionId,
  });
  await input.database.insert(resumeVersions).values({
    id: versionId,
    resumeId,
    versionNumber: 1,
    sourceType: input.sourceType,
    originalFilename:
      input.sourceType === "uploaded" && attachmentComplete
        ? "resume.pdf"
        : null,
    storedPath:
      input.sourceType === "uploaded" && attachmentComplete
        ? "uploads/resume.pdf"
        : null,
    mimeType:
      input.sourceType === "uploaded" && attachmentComplete
        ? "application/pdf"
        : null,
    fileSize:
      input.sourceType === "uploaded" && attachmentComplete ? 1024 : null,
    extractedText:
      input.sourceType === "uploaded"
        ? "Original extracted PDF text"
        : serializeParsedResume(originalParsed),
    parsedJson: originalParsed,
    parseStatus: "parsed",
  });
  return { resumeId, versionId };
}

test("generated edits keep generated source semantics and canonical text", {
  skip: databaseAvailable,
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  let resumeId: string | null = null;
  try {
    await database.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
    });
    const source = await createSource({
      database,
      userId,
      sourceType: "generated",
    });
    resumeId = source.resumeId;

    const edited = await editResumeVersion(database, {
      ownerUserId: userId,
      resumeId,
      sourceVersionId: source.versionId,
      parsed: editedParsed,
    });

    assert.equal(edited.versionNumber, 2);
    assert.equal(edited.sourceType, "generated");
    assert.equal(edited.originalFilename, null);
    assert.equal(edited.storedPath, null);
    assert.equal(edited.mimeType, null);
    assert.equal(edited.fileSize, null);
    assert.equal(edited.extractedText, serializeParsedResume(editedParsed));
    const [resume] = await database.select().from(resumes)
      .where(eq(resumes.id, resumeId));
    assert.equal(resume.currentVersionId, edited.id);
  } finally {
    try {
      if (resumeId) {
        await database.delete(resumes).where(eq(resumes.id, resumeId));
      }
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("uploaded edits preserve complete attachment metadata and PDF text", {
  skip: databaseAvailable,
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  let resumeId: string | null = null;
  try {
    await database.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
    });
    const source = await createSource({
      database,
      userId,
      sourceType: "uploaded",
    });
    resumeId = source.resumeId;

    const edited = await editResumeVersion(database, {
      ownerUserId: userId,
      resumeId,
      sourceVersionId: source.versionId,
      parsed: editedParsed,
    });

    assert.equal(edited.sourceType, "uploaded");
    assert.equal(edited.originalFilename, "resume.pdf");
    assert.equal(edited.storedPath, "uploads/resume.pdf");
    assert.equal(edited.mimeType, "application/pdf");
    assert.equal(edited.fileSize, 1024);
    assert.equal(edited.extractedText, "Original extracted PDF text");
  } finally {
    try {
      if (resumeId) {
        await database.delete(resumes).where(eq(resumes.id, resumeId));
      }
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("invalid uploaded sources and pointer failures leave no child version", {
  skip: databaseAvailable,
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  const resumeIds: string[] = [];
  try {
    await database.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
    });
    const incomplete = await createSource({
      database,
      userId,
      sourceType: "uploaded",
      attachmentComplete: false,
    });
    resumeIds.push(incomplete.resumeId);

    await assert.rejects(
      editResumeVersion(database, {
        ownerUserId: userId,
        resumeId: incomplete.resumeId,
        sourceVersionId: incomplete.versionId,
        parsed: editedParsed,
      }),
      (error) =>
        error instanceof ResumeEditError
        && error.code === "uploaded_attachment_incomplete",
    );

    const generated = await createSource({
      database,
      userId,
      sourceType: "generated",
    });
    resumeIds.push(generated.resumeId);
    await assert.rejects(
      editResumeVersion(
        database,
        {
          ownerUserId: userId,
          resumeId: generated.resumeId,
          sourceVersionId: generated.versionId,
          parsed: editedParsed,
        },
        {
          beforeCurrentVersionUpdate() {
            throw new Error("forced pointer update failure");
          },
        },
      ),
      /forced pointer update failure/,
    );

    for (const source of [incomplete, generated]) {
      const versions = await database.select().from(resumeVersions)
        .where(eq(resumeVersions.resumeId, source.resumeId));
      const [resume] = await database.select().from(resumes)
        .where(eq(resumes.id, source.resumeId));
      assert.equal(versions.length, 1);
      assert.equal(resume.currentVersionId, source.versionId);
    }
  } finally {
    try {
      for (const resumeId of resumeIds) {
        await database.delete(resumes).where(eq(resumes.id, resumeId));
      }
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("concurrent edits receive distinct sequential versions and a valid pointer", {
  skip: databaseAvailable,
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  let resumeId: string | null = null;
  try {
    await database.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
    });
    const source = await createSource({
      database,
      userId,
      sourceType: "generated",
    });
    resumeId = source.resumeId;

    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        editResumeVersion(database, {
          ownerUserId: userId,
          resumeId: source.resumeId,
          sourceVersionId: source.versionId,
          parsed: {
            ...editedParsed,
            summary: `Concurrent edit ${index + 1}`,
          },
        })),
    );

    const versions = await database.select().from(resumeVersions)
      .where(eq(resumeVersions.resumeId, source.resumeId))
      .orderBy(asc(resumeVersions.versionNumber));
    assert.deepEqual(
      versions.map((version) => version.versionNumber),
      [1, 2, 3, 4, 5],
    );
    const [resume] = await database.select().from(resumes)
      .where(eq(resumes.id, source.resumeId));
    assert.equal(resume.currentVersionId, versions.at(-1)?.id);
  } finally {
    try {
      if (resumeId) {
        await database.delete(resumes).where(eq(resumes.id, resumeId));
      }
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});
