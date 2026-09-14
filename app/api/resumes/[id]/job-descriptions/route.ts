import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resumes } from "@/lib/db/schema";
import {
  extractJobDescriptionText,
  MAX_JD_FILE_SIZE,
  MAX_JD_TEXT_LENGTH,
} from "@/lib/jd/extract-text";
import { parseJobDescription } from "@/lib/jd/parse-jd";
import {
  insertResumeJobDescription,
  listResumeJobDescriptions,
} from "@/lib/jd/persistence/repository";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();

export async function handleListResumeJobDescriptions(
  input: { resumeId: string; userId: string },
  dependencies: { database?: typeof db } = {},
) {
  const database = dependencies.database ?? db;
  const parsedId = uuidSchema.safeParse(input.resumeId);
  if (!parsedId.success) {
    return { status: 404 as const, body: { error: "Resume not found" } };
  }

  const [ownedResume] = await database
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, parsedId.data), eq(resumes.userId, input.userId)))
    .limit(1);

  if (!ownedResume) {
    return { status: 404 as const, body: { error: "Resume not found" } };
  }

  const items = await listResumeJobDescriptions(database, parsedId.data, input.userId);
  return { status: 200 as const, body: { items } };
}

export async function handleCreateResumeJobDescription(
  input: {
    resumeId: string;
    userId: string;
    text?: string;
    title?: string;
    company?: string;
    file?: {
      name: string;
      size: number;
      type: string;
      buffer: Buffer;
    };
  },
  dependencies: {
    database?: typeof db;
    blobToken?: string;
  } = {},
) {
  const database = dependencies.database ?? db;
  const parsedId = uuidSchema.safeParse(input.resumeId);
  if (!parsedId.success) {
    return { status: 404 as const, body: { error: "Resume not found" } };
  }

  const [ownedResume] = await database
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, parsedId.data), eq(resumes.userId, input.userId)))
    .limit(1);

  if (!ownedResume) {
    return { status: 404 as const, body: { error: "Resume not found" } };
  }

  let rawText = "";
  let originalFilename: string | null = null;
  let storedPath: string | null = null;
  let fileSize: number | null = null;
  let sourceType: "pasted" | "uploaded_pdf" | "uploaded_docx" = "pasted";

  if (input.file) {
    if (input.file.size > MAX_JD_FILE_SIZE) {
      return { status: 400 as const, body: { error: "File size must be less than 1MB" } };
    }

    originalFilename = input.file.name;
    fileSize = input.file.size;
    const mimeType = input.file.type.toLowerCase();
    const filenameLower = input.file.name.toLowerCase();

    if (mimeType === "application/pdf" || filenameLower.endsWith(".pdf")) {
      sourceType = "uploaded_pdf";
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/docx" ||
      filenameLower.endsWith(".docx")
    ) {
      sourceType = "uploaded_docx";
    } else {
      return {
        status: 400 as const,
        body: { error: "Unsupported file format. Supported formats: PDF, Word (.docx), plain text." },
      };
    }

    const blobToken = (
      dependencies.blobToken ??
      process.env.BLOB_READ_WRITE_TOKEN
    )?.replace(/^["']|["']$/g, "").trim();

    if (blobToken) {
      try {
        const normalizedName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = await put(`job-descriptions/${randomUUID()}-${normalizedName}`, input.file.buffer, {
          access: "public",
          contentType: input.file.type || "application/octet-stream",
          addRandomSuffix: false,
          token: blobToken,
        });
        storedPath = blob.url;
      } catch (blobError) {
        console.error("Blob upload failed (non-fatal):", blobError);
      }
    }

    try {
      rawText = await extractJobDescriptionText({
        buffer: input.file.buffer,
        mimeType: input.file.type,
        filename: input.file.name,
      });
    } catch (err) {
      return {
        status: 400 as const,
        body: { error: err instanceof Error ? err.message : "Failed to extract text from file" },
      };
    }
  } else if (input.text && input.text.trim()) {
    sourceType = "pasted";
    try {
      rawText = await extractJobDescriptionText({ text: input.text });
    } catch (err) {
      return {
        status: 400 as const,
        body: { error: err instanceof Error ? err.message : "Invalid job description text" },
      };
    }
  } else {
    return {
      status: 400 as const,
      body: { error: "Either file or text must be provided" },
    };
  }

  const parsed = await parseJobDescription(rawText);
  const finalTitle = input.title?.trim() || parsed.roleTitle || "目标岗位";
  const finalCompany = input.company?.trim() || parsed.company || null;

  const created = await insertResumeJobDescription(database, {
    resumeId: parsedId.data,
    userId: input.userId,
    title: finalTitle,
    company: finalCompany,
    sourceType,
    originalFilename,
    storedPath,
    fileSize,
    rawText,
    parsedJson: parsed,
  });

  return { status: 201 as const, body: { item: created } };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const outcome = await handleListResumeJobDescriptions({
      resumeId: id,
      userId,
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    console.error("Failed to list job descriptions:", error);
    return NextResponse.json({ error: "Failed to list job descriptions" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const title = (formData.get("title") as string | null)?.trim() || undefined;
      const company = (formData.get("company") as string | null)?.trim() || undefined;
      const text = (formData.get("text") as string | null)?.trim() || undefined;

      let fileData: { name: string; size: number; type: string; buffer: Buffer } | undefined;
      if (file && file.size > 0) {
        fileData = {
          name: file.name,
          size: file.size,
          type: file.type,
          buffer: Buffer.from(await file.arrayBuffer()),
        };
      }

      const outcome = await handleCreateResumeJobDescription({
        resumeId: id,
        userId,
        text,
        title,
        company,
        file: fileData,
      });

      return NextResponse.json(outcome.body, { status: outcome.status });
    }

    const json = await request.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const text = typeof json.text === "string" ? json.text : undefined;
    const title = typeof json.title === "string" && json.title.trim() ? json.title.trim() : undefined;
    const company = typeof json.company === "string" && json.company.trim() ? json.company.trim() : undefined;

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Job description text is required" }, { status: 400 });
    }

    if (text.trim().length > MAX_JD_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Job description text must be ${MAX_JD_TEXT_LENGTH} characters or less` },
        { status: 400 },
      );
    }

    const outcome = await handleCreateResumeJobDescription({
      resumeId: id,
      userId,
      text,
      title,
      company,
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (error) {
    console.error("Failed to create job description:", error);
    return NextResponse.json({ error: "Failed to create job description" }, { status: 500 });
  }
}
