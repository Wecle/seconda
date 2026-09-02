import { extractText } from "unpdf";
import { normalizeExtractedPdfText } from "./pdf-text-normalize";

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
