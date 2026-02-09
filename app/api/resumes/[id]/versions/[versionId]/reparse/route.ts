import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { extractTextFromPDF } from "@/lib/resume/parse-pdf";
import { parseResumeWithAI } from "@/lib/resume/parse-resume";

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const { id, versionId } = await params;

    const [version] = await db
      .select({
        id: resumeVersions.id,
        resumeId: resumeVersions.resumeId,
        storedPath: resumeVersions.storedPath,
        extractedText: resumeVersions.extractedText,
        parseStatus: resumeVersions.parseStatus,
      })
      .from(resumeVersions)
      .where(
        and(eq(resumeVersions.id, versionId), eq(resumeVersions.resumeId, id)),
      );

    if (!version) {
      return NextResponse.json(
        { error: "Resume version not found" },
        { status: 404 },
      );
    }

    if (version.parseStatus !== "failed") {
      return NextResponse.json(
        { error: "Only failed resume versions can be re-parsed" },
        { status: 400 },
      );
    }

    let extractedText = version.extractedText?.trim() ?? "";

    if (extractedText.length >= 50) {
      await db
        .update(resumeVersions)
        .set({ parseStatus: "parsing", parseError: null })
        .where(eq(resumeVersions.id, versionId));
    } else {
      await db
        .update(resumeVersions)
        .set({ parseStatus: "extracting", parseError: null })
        .where(eq(resumeVersions.id, versionId));

      try {
        const response = await fetch(version.storedPath);
        if (!response.ok) {
          throw new Error(`Failed to fetch original file (${response.status})`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        extractedText = await extractTextFromPDF(buffer);

        if (extractedText.length < 50) {
          throw new Error(
            "Extracted text is too short. The PDF may be scanned or image-based.",
          );
        }

        await db
          .update(resumeVersions)
          .set({
            extractedText,
            parseStatus: "parsing",
            parseError: null,
          })
          .where(eq(resumeVersions.id, versionId));
      } catch (extractError) {
        await db
          .update(resumeVersions)
          .set({
            parseStatus: "failed",
            parseError: `Text extraction failed: ${formatError(extractError)}`,
          })
          .where(eq(resumeVersions.id, versionId));

        return NextResponse.json(
          { error: "Failed to extract text from resume." },
          { status: 500 },
        );
      }
    }

    try {
      const parsed = await parseResumeWithAI(extractedText);

      await db
        .update(resumeVersions)
        .set({
          parsedJson: parsed,
          parseStatus: "parsed",
          parseError: null,
        })
        .where(eq(resumeVersions.id, versionId));

      if (parsed.title) {
        await db
          .update(resumes)
          .set({ title: parsed.title, updatedAt: new Date() })
          .where(eq(resumes.id, id));
      }

      return NextResponse.json({
        id,
        versionId,
        status: "parsed",
        data: parsed,
      });
    } catch (aiError) {
      await db
        .update(resumeVersions)
        .set({
          parseStatus: "failed",
          parseError: `AI parsing failed: ${formatError(aiError)}`,
        })
        .where(eq(resumeVersions.id, versionId));

      return NextResponse.json(
        {
          error:
            "AI parsing failed. Please verify model configuration and retry.",
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error re-parsing resume:", error);
    return NextResponse.json(
      { error: "Failed to re-parse resume" },
      { status: 500 },
    );
  }
}
