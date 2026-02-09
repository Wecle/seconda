import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableAutoFetch: true,
    worker: null as never,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join(" ");
    pages.push(text);
  }

  doc.destroy();
  return pages.join(" ").replace(/\s+/g, " ").trim();
}
