let pdfOxidePromise: Promise<typeof import("pdf-oxide")> | null = null;

async function getPdfOxide() {
  if (!pdfOxidePromise) {
    pdfOxidePromise = import("pdf-oxide");
  }
  return pdfOxidePromise;
}

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

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const { PdfDocument } = await getPdfOxide();
  const doc = PdfDocument.openFromBuffer(buffer);
  try {
    const pageCount = doc.pageCount();
    if (pageCount === 0) {
      return "";
    }

    let extracted = "";
    try {
      extracted = doc.toPlainTextAll();
    } catch {
      extracted = "";
    }

    if (!extracted || extracted.trim().length === 0) {
      try {
        extracted = doc.extractAllText();
      } catch {
        extracted = "";
      }
    }

    return normalizeExtractedPdfText(extracted);
  } finally {
    doc.close();
  }
}
