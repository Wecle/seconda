import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  interviewJobSnapshots,
  resumeJobDescriptions,
} from "@/lib/db/schema";
import type { ParsedJobDescription } from "../types";
import { hashCanonical } from "@/lib/interview/domain/create-interview";

export type JdDatabaseExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function insertResumeJobDescription(
  executor: JdDatabaseExecutor,
  data: {
    resumeId: string;
    userId: string;
    title: string;
    company?: string | null;
    sourceType: "pasted" | "uploaded_pdf" | "uploaded_docx";
    originalFilename?: string | null;
    storedPath?: string | null;
    fileSize?: number | null;
    rawText: string;
    parsedJson: ParsedJobDescription;
    parseStatus?: "parsing" | "parsed" | "failed";
    parseError?: string | null;
  },
) {
  const [created] = await executor
    .insert(resumeJobDescriptions)
    .values({
      resumeId: data.resumeId,
      userId: data.userId,
      title: data.title,
      company: data.company ?? null,
      sourceType: data.sourceType,
      originalFilename: data.originalFilename ?? null,
      storedPath: data.storedPath ?? null,
      fileSize: data.fileSize ?? null,
      rawText: data.rawText,
      parsedJson: data.parsedJson,
      parseStatus: data.parseStatus ?? "parsed",
      parseError: data.parseError ?? null,
    })
    .returning();
  return created;
}

export async function listResumeJobDescriptions(
  executor: JdDatabaseExecutor,
  resumeId: string,
  userId: string,
) {
  return executor
    .select()
    .from(resumeJobDescriptions)
    .where(
      and(
        eq(resumeJobDescriptions.resumeId, resumeId),
        eq(resumeJobDescriptions.userId, userId),
      ),
    )
    .orderBy(desc(resumeJobDescriptions.createdAt));
}

export async function findOwnedJobDescription(
  executor: JdDatabaseExecutor,
  jdId: string,
  userId: string,
) {
  const [jd] = await executor
    .select()
    .from(resumeJobDescriptions)
    .where(
      and(
        eq(resumeJobDescriptions.id, jdId),
        eq(resumeJobDescriptions.userId, userId),
      ),
    )
    .limit(1);
  return jd ?? null;
}

export async function insertInterviewJobSnapshot(
  executor: JdDatabaseExecutor,
  data: {
    interviewId: string;
    jobDescriptionId: string;
    title: string;
    company?: string | null;
    sourceType: string;
    rawText: string;
    parsedJson: ParsedJobDescription;
  },
) {
  const canonicalText = `职位：${data.title}${data.company ? ` | 公司：${data.company}` : ""}\n\n【核心职责】\n${data.parsedJson.coreResponsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n【必备技能】\n${data.parsedJson.mustHaveSkills.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
  const contentHash = hashCanonical({ raw: data.rawText, parsed: data.parsedJson });

  const [snapshot] = await executor
    .insert(interviewJobSnapshots)
    .values({
      interviewId: data.interviewId,
      jobDescriptionId: data.jobDescriptionId,
      title: data.title,
      company: data.company ?? null,
      sourceType: data.sourceType,
      rawText: data.rawText,
      parsedJson: data.parsedJson,
      canonicalText,
      contentHash,
    })
    .returning();
  return snapshot;
}

export async function findInterviewJobSnapshot(
  executor: JdDatabaseExecutor,
  interviewId: string,
) {
  const [snapshot] = await executor
    .select()
    .from(interviewJobSnapshots)
    .where(eq(interviewJobSnapshots.interviewId, interviewId))
    .limit(1);
  return snapshot ?? null;
}

export async function deleteResumeJobDescriptionRecord(
  executor: JdDatabaseExecutor,
  jdId: string,
  resumeId: string,
  userId: string,
) {
  const [deleted] = await executor
    .delete(resumeJobDescriptions)
    .where(
      and(
        eq(resumeJobDescriptions.id, jdId),
        eq(resumeJobDescriptions.resumeId, resumeId),
        eq(resumeJobDescriptions.userId, userId),
      ),
    )
    .returning();
  return deleted ?? null;
}
