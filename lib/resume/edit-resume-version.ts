import { and, desc, eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { serializeParsedResume } from "./canonical-text";
import type { ParsedResume } from "./types";

type ResumeDatabase = typeof db;

export type ResumeEditErrorCode =
  | "resume_not_found"
  | "version_not_found"
  | "uploaded_attachment_incomplete";

export class ResumeEditError extends Error {
  constructor(readonly code: ResumeEditErrorCode) {
    super(code);
    this.name = "ResumeEditError";
  }
}

export interface EditResumeVersionInput {
  ownerUserId: string;
  resumeId: string;
  sourceVersionId: string;
  parsed: ParsedResume;
}

interface EditResumeVersionHooks {
  beforeCurrentVersionUpdate?: () => void | Promise<void>;
}

function hasCompleteUploadedAttachment(source: {
  originalFilename: string | null;
  storedPath: string | null;
  mimeType: string | null;
  fileSize: number | null;
}) {
  return Boolean(
    source.originalFilename?.trim()
      && source.storedPath?.trim()
      && source.mimeType?.trim()
      && source.fileSize !== null,
  );
}

export async function editResumeVersion(
  database: ResumeDatabase,
  input: EditResumeVersionInput,
  hooks: EditResumeVersionHooks = {},
) {
  return database.transaction(async (transaction) => {
    const [resume] = await transaction
      .select({ id: resumes.id })
      .from(resumes)
      .where(
        and(
          eq(resumes.id, input.resumeId),
          eq(resumes.userId, input.ownerUserId),
        ),
      )
      .for("update")
      .limit(1);
    if (!resume) throw new ResumeEditError("resume_not_found");

    const [sourceVersion] = await transaction
      .select()
      .from(resumeVersions)
      .where(
        and(
          eq(resumeVersions.id, input.sourceVersionId),
          eq(resumeVersions.resumeId, input.resumeId),
        ),
      )
      .limit(1);
    if (!sourceVersion) throw new ResumeEditError("version_not_found");

    if (
      sourceVersion.sourceType === "uploaded"
      && !hasCompleteUploadedAttachment(sourceVersion)
    ) {
      throw new ResumeEditError("uploaded_attachment_incomplete");
    }

    const [latestVersion] = await transaction
      .select({ versionNumber: resumeVersions.versionNumber })
      .from(resumeVersions)
      .where(eq(resumeVersions.resumeId, input.resumeId))
      .orderBy(desc(resumeVersions.versionNumber))
      .limit(1);

    const [newVersion] = await transaction
      .insert(resumeVersions)
      .values({
        resumeId: input.resumeId,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        sourceType: sourceVersion.sourceType,
        originalFilename:
          sourceVersion.sourceType === "generated"
            ? null
            : sourceVersion.originalFilename,
        storedPath:
          sourceVersion.sourceType === "generated"
            ? null
            : sourceVersion.storedPath,
        mimeType:
          sourceVersion.sourceType === "generated"
            ? null
            : sourceVersion.mimeType,
        fileSize:
          sourceVersion.sourceType === "generated"
            ? null
            : sourceVersion.fileSize,
        extractedText:
          sourceVersion.sourceType === "generated"
            ? serializeParsedResume(input.parsed)
            : sourceVersion.extractedText,
        parsedJson: input.parsed,
        parseStatus: "parsed",
      })
      .returning();

    await hooks.beforeCurrentVersionUpdate?.();

    await transaction
      .update(resumes)
      .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
      .where(eq(resumes.id, input.resumeId));

    return newVersion;
  });
}
