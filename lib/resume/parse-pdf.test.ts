import assert from "node:assert/strict";
import test from "node:test";
import { extractTextFromPDF } from "./parse-pdf";

const samplePdfBuffer = Buffer.from(
  "%PDF-1.4\n" +
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n" +
  "4 0 obj << /Length 53 >> stream\n" +
  "BT /F1 18 Tf 100 700 Td (Software Engineer Resume) Tj ET\n" +
  "endstream endobj\n" +
  "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n" +
  "xref\n" +
  "0 6\n" +
  "0000000000 65535 f \n" +
  "0000000009 00000 n \n" +
  "0000000058 00000 n \n" +
  "0000000115 00000 n \n" +
  "0000000244 00000 n \n" +
  "0000000348 00000 n \n" +
  "trailer << /Size 6 /Root 1 0 R >>\n" +
  "startxref\n" +
  "427\n" +
  "%%EOF"
);

test("extractTextFromPDF extracts text/markdown from PDF buffer using pdf-oxide", async () => {
  const text = await extractTextFromPDF(samplePdfBuffer);
  assert.ok(text.length > 0, "Extracted text should not be empty");
  assert.match(text, /Software Engineer Resume/);
});
