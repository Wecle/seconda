import { and, eq, inArray, sql } from "drizzle-orm";
import { interviewResumeSnapshots, resumes, resumeVersions } from "@/lib/db/schema";
import type { ResumeSourceType } from "@/lib/resume/types";

type ResumeDatabase = typeof import("@/lib/db").db;

export type ResumeSnapshotSource = {
  ownerUserId: string | null;
  resumeTitle: string;
  versionNumber: number;
  sourceType: ResumeSourceType;
  originalFilename: string | null;
  storedPath: string | null;
  mimeType: string | null;
  fileSize: number | null;
  extractedText: string | null;
  parsedJson: unknown;
  parseStatus: string;
};

export function createResumeSnapshotPayload(source: ResumeSnapshotSource) {
  return {
    ...source,
    parsedJson: source.parsedJson === null || source.parsedJson === undefined
      ? null
      : structuredClone(source.parsedJson),
  };
}

export function selectDeletableResumeAttachments(
  versionPaths: Array<string | null>,
  snapshotPaths: Array<string | null>,
) {
  const protectedPaths = new Set(
    snapshotPaths.filter((path): path is string => Boolean(path)),
  );
  return [...new Set(versionPaths.filter((path): path is string => Boolean(path)))]
    .filter((path) => !protectedPaths.has(path));
}

export function deleteResumePreservingSnapshots(
  database: ResumeDatabase,
  input: { resumeId: string; ownerUserId: string },
) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`resume:${input.resumeId}`}))`);
    const [resume] = await tx.select({ id: resumes.id }).from(resumes)
      .where(and(eq(resumes.id, input.resumeId), eq(resumes.userId, input.ownerUserId)));
    if (!resume) return null;
    const versions = await tx.select({ storedPath: resumeVersions.storedPath })
      .from(resumeVersions)
      .where(eq(resumeVersions.resumeId, input.resumeId));
    const versionPaths = versions.map((version) => version.storedPath);
    const attachmentPaths = versionPaths.filter((path): path is string => Boolean(path));
    const protectedAttachments = attachmentPaths.length > 0
      ? await tx.select({ storedPath: interviewResumeSnapshots.storedPath })
        .from(interviewResumeSnapshots)
        .where(inArray(interviewResumeSnapshots.storedPath, attachmentPaths))
      : [];
    await tx.delete(resumes)
      .where(and(eq(resumes.id, input.resumeId), eq(resumes.userId, input.ownerUserId)));
    return selectDeletableResumeAttachments(
      versionPaths,
      protectedAttachments.map((snapshot) => snapshot.storedPath),
    );
  });
}
