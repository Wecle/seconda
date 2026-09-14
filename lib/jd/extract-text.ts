import mammoth from "mammoth";
import { extractTextFromPDF } from "@/lib/resume/parse-pdf";

export function normalizeJdText(text: string): string {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ ]*\n[ ]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MAX_JD_FILE_SIZE = 1 * 1024 * 1024; // 1MB
export const MAX_JD_TEXT_LENGTH = 8000; // 8000 characters

export async function extractJobDescriptionText(input: {
  buffer?: Buffer;
  text?: string;
  mimeType?: string;
  filename?: string;
}): Promise<string> {
  if (input.text !== undefined) {
    if (input.text.length > MAX_JD_TEXT_LENGTH) {
      throw new Error(`Job description text exceeds ${MAX_JD_TEXT_LENGTH} characters limit`);
    }
    const normalized = normalizeJdText(input.text);
    if (!normalized) {
      throw new Error("Job description text cannot be empty");
    }
    return normalized.slice(0, MAX_JD_TEXT_LENGTH);
  }

  if (!input.buffer) {
    throw new Error("Either text or buffer must be provided");
  }

  if (input.buffer.byteLength > MAX_JD_FILE_SIZE) {
    throw new Error("File size exceeds 1MB limit");
  }

  const filename = input.filename?.toLowerCase() ?? "";
  const mime = input.mimeType?.toLowerCase() ?? "";

  const isPdf = mime === "application/pdf" || filename.endsWith(".pdf");
  const isDocx =
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/docx" ||
    filename.endsWith(".docx");

  let raw = "";
  if (isPdf) {
    raw = await extractTextFromPDF(input.buffer);
  } else if (isDocx) {
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    raw = result.value;
  } else {
    throw new Error("Unsupported file format. Supported formats: PDF, Word (.docx), plain text.");
  }

  const normalized = normalizeJdText(raw);
  if (!normalized) {
    throw new Error("Failed to extract readable text from the uploaded document.");
  }
  return normalized.slice(0, MAX_JD_TEXT_LENGTH);
}
