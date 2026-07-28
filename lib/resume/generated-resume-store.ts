import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import type { ParsedResume } from "./types";

type ResumeDatabase = typeof db;
type ResumeQueryDatabase = Pick<ResumeDatabase, "select">;

export interface PersistGeneratedResumeInput {
  ownerUserId: string;
  idempotencyKey: string;
  title: string;
  parsed: ParsedResume;
  extractedText: string;
}

export interface PersistedGeneratedResume {
  id: string;
  versionId: string;
  status: "parsed";
  data: ParsedResume;
}

export async function findGeneratedResumeByKey(
  database: ResumeQueryDatabase,
  ownerUserId: string,
  idempotencyKey: string,
): Promise<PersistedGeneratedResume | null> {
  const [existing] = await database.select({
    id: resumes.id,
    versionId: resumeVersions.id,
    data: resumeVersions.parsedJson,
  }).from(resumes)
    .innerJoin(resumeVersions, eq(resumeVersions.id, resumes.currentVersionId))
    .where(and(
      eq(resumes.userId, ownerUserId),
      eq(resumes.creationIdempotencyKey, idempotencyKey),
      eq(resumeVersions.sourceType, "generated"),
    ))
    .limit(1);

  if (!existing) return null;
  return {
    id: existing.id,
    versionId: existing.versionId,
    status: "parsed",
    data: existing.data as ParsedResume,
  };
}

export async function persistGeneratedResume(
  database: ResumeDatabase,
  input: PersistGeneratedResumeInput,
): Promise<PersistedGeneratedResume> {
  const resumeId = randomUUID();
  const versionId = randomUUID();

  return database.transaction(async (transaction) => {
    const existing = await findGeneratedResumeByKey(
      transaction,
      input.ownerUserId,
      input.idempotencyKey,
    );
    if (existing) return existing;

    const inserted = await transaction.insert(resumes).values({
      id: resumeId,
      userId: input.ownerUserId,
      title: input.title,
      currentVersionId: versionId,
      creationIdempotencyKey: input.idempotencyKey,
    }).onConflictDoNothing().returning({ id: resumes.id });

    if (!inserted[0]) {
      const winner = await findGeneratedResumeByKey(
        transaction,
        input.ownerUserId,
        input.idempotencyKey,
      );
      if (winner) return winner;
      throw new Error("Idempotent generated resume creation could not be resolved");
    }

    await transaction.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      sourceType: "generated",
      originalFilename: null,
      storedPath: null,
      mimeType: null,
      fileSize: null,
      extractedText: input.extractedText,
      parsedJson: input.parsed,
      parseStatus: "parsed",
    });

    return {
      id: resumeId,
      versionId,
      status: "parsed",
      data: input.parsed,
    };
  });
}
