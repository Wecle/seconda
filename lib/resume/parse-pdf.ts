import { extractText } from "unpdf";

function normalizeExtractedPdfText(text: string): string {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, "$1")
    .replace(/(\p{Script=Han})\s+([，。！？：；、）】》」』])/gu, "$1$2")
    .replace(/([（【《「『])\s+(\p{Script=Han})/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/[ ]*\n[ ]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractTextFromPDF(buffer: Buffer | Uint8Array | ArrayBuffer): Promise<string> {
  const uint8 =
    buffer instanceof Uint8Array && !Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.isBuffer(buffer)
        ? new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
        : new Uint8Array(buffer);

  const result = await extractText(uint8, { mergePages: true });
  const rawText = Array.isArray(result.text) ? result.text.join("\n") : (result.text ?? "");
  return normalizeExtractedPdfText(rawText);
}
