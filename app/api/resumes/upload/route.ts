import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractTextFromPDF } from "@/lib/resume/parse-pdf";
import { parseResumeWithAI } from "@/lib/resume/parse-resume";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

async function ensureUploadsDir() {
  try {
    await fs.access(UPLOADS_DIR);
  } catch {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || "Untitled Resume";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size must be less than 10MB" },
        { status: 400 }
      );
    }

    await ensureUploadsDir();

    const resumeId = randomUUID();
    const versionId = randomUUID();
    const ext = path.extname(file.name) || ".pdf";
    const storedFilename = `${versionId}${ext}`;
    const storedPath = path.join(UPLOADS_DIR, storedFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(storedPath, buffer);

    await db.insert(resumes).values({
      id: resumeId,
      title,
      currentVersionId: versionId,
    });

    await db.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      originalFilename: file.name,
      storedPath,
      mimeType: file.type,
      fileSize: file.size,
      parseStatus: "extracting",
    });

    let extractedText = "";
    try {
      extractedText = await extractTextFromPDF(buffer);

      await db
        .update(resumeVersions)
        .set({ extractedText, parseStatus: "parsing" })
        .where(eq(resumeVersions.id, versionId));
    } catch (extractError) {
      await db
        .update(resumeVersions)
        .set({
          parseStatus: "failed",
          parseError: `Text extraction failed: ${extractError instanceof Error ? extractError.message : String(extractError)}`,
        })
        .where(eq(resumeVersions.id, versionId));

      return NextResponse.json({
        id: resumeId,
        versionId,
        status: "extraction_failed",
        error: "Failed to extract text from PDF",
      });
    }

    if (extractedText.length < 50) {
      await db
        .update(resumeVersions)
        .set({
          parseStatus: "failed",
          parseError:
            "Extracted text is too short. The PDF may be scanned or image-based.",
        })
        .where(eq(resumeVersions.id, versionId));

      return NextResponse.json({
        id: resumeId,
        versionId,
        status: "extraction_failed",
        error:
          "Could not extract enough text from the PDF. It may be a scanned document.",
      });
    }

    try {
      const parsed = await parseResumeWithAI(extractedText);

      await db
        .update(resumeVersions)
        .set({ parsedJson: parsed, parseStatus: "parsed" })
        .where(eq(resumeVersions.id, versionId));

      if (parsed.title) {
        await db
          .update(resumes)
          .set({ title: parsed.title, updatedAt: new Date() })
          .where(eq(resumes.id, resumeId));
      }

      return NextResponse.json({
        id: resumeId,
        versionId,
        status: "parsed",
        data: parsed,
      });
    } catch (aiError) {
      await db
        .update(resumeVersions)
        .set({
          parseStatus: "failed",
          parseError: `AI parsing failed: ${aiError instanceof Error ? aiError.message : String(aiError)}`,
        })
        .where(eq(resumeVersions.id, versionId));

      return NextResponse.json({
        id: resumeId,
        versionId,
        status: "parse_failed",
        error:
          "AI parsing failed. The resume was saved and can be re-parsed later.",
      });
    }
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
