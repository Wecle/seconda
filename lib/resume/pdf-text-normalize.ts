export function normalizeExtractedPdfText(text: string): string {
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
