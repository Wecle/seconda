import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resumes, resumeVersions } from "@/lib/db/schema";
import { extractTextFromPDF } from "@/lib/resume/parse-pdf";
import { parseResumeWithAI } from "@/lib/resume/parse-resume";
import { planResumeReparse } from "@/lib/resume/reparse-policy";
import { getCurrentUserId } from "@/lib/auth/session";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, versionId } = await params;

    const [version] = await db
      .select({
        id: resumeVersions.id,
        resumeId: resumeVersions.resumeId,
        sourceType: resumeVersions.sourceType,
        storedPath: resumeVersions.storedPath,
        extractedText: resumeVersions.extractedText,
        parseStatus: resumeVersions.parseStatus,
      })
      .from(resumeVersions)
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(
        and(
          eq(resumeVersions.id, versionId),
          eq(resumeVersions.resumeId, id),
          eq(resumes.userId, userId),
        ),
      );

    if (!version) {
      return NextResponse.json(
        { error: "Resume version not found" },
        { status: 404 },
      );
    }

    const reparsePlan = planResumeReparse(version);
    if (reparsePlan.kind === "unsupported_source") {
      return NextResponse.json(
        { error: "AI-generated resume versions cannot be re-parsed" },
        { status: 400 },
      );
    }

    if (version.parseStatus !== "failed") {
      return NextResponse.json(
        { error: "Only failed resume versions can be re-parsed" },
        { status: 400 },
      );
    }

    if (reparsePlan.kind === "missing_file") {
      return NextResponse.json(
        { error: "Resume version has no original file" },
        { status: 400 },
      );
    }

    let extractedText = reparsePlan.kind === "parse_text"
      ? reparsePlan.extractedText
      : "";

    if (reparsePlan.kind === "parse_text") {
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
        const response = await fetch(reparsePlan.storedPath);
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
          parseError: JSON.stringify(sanitizeAIError(aiError)),
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
    console.error("Error re-parsing resume:", sanitizeAIError(error));
    return NextResponse.json(
      { error: "Failed to re-parse resume" },
      { status: 500 },
    );
  }
}
