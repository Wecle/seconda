import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { randomUUID } from "crypto";
import { putBlob } from "@/lib/storage";
import { getCurrentUserId } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || "Untitled Resume";
    const extractedTextRaw = formData.get("extractedText");
    const extractedText =
      typeof extractedTextRaw === "string"
        ? extractedTextRaw.trim().slice(0, 1_000_000)
        : "";

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

    const resumeId = randomUUID();
    const versionId = randomUUID();
    const normalizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const blobPathname = `resumes/${versionId}-${normalizedName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const blob = await putBlob(blobPathname, buffer, {
      contentType: file.type,
    });

    await db.insert(resumes).values({
      id: resumeId,
      userId,
      title,
      currentVersionId: versionId,
    });

    if (extractedText.length >= 50) {
      await db.insert(resumeVersions).values({
        id: versionId,
        resumeId,
        versionNumber: 1,
        sourceType: "uploaded",
        originalFilename: file.name,
        storedPath: blob.key,
        mimeType: file.type,
        fileSize: file.size,
        extractedText,
        parseStatus: "parsing",
      });

      return NextResponse.json({
        id: resumeId,
        versionId,
        status: "parsing",
      });
    }

    await db.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      sourceType: "uploaded",
      originalFilename: file.name,
      storedPath: blob.key,
      mimeType: file.type,
      fileSize: file.size,
      parseStatus: "failed",
      parseError:
        "Extracted text is too short. The PDF may be scanned or image-based.",
    });

    return NextResponse.json({
      id: resumeId,
      versionId,
      status: "extraction_failed",
      error:
        "Could not extract enough text from the PDF. It may be a scanned document.",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
