import type { ResumeSourceType } from "./types";

type ResumeReparseSource = {
  sourceType: ResumeSourceType;
  extractedText: string | null;
  storedPath: string | null;
};

export type ResumeReparsePlan =
  | { kind: "unsupported_source" }
  | { kind: "parse_text"; extractedText: string }
  | { kind: "extract_file"; storedPath: string }
  | { kind: "missing_file" };

export function planResumeReparse(source: ResumeReparseSource): ResumeReparsePlan {
  if (source.sourceType === "generated") {
    return { kind: "unsupported_source" };
  }

  const extractedText = source.extractedText?.trim() ?? "";
  if (extractedText.length >= 50) {
    return { kind: "parse_text", extractedText };
  }
  if (source.storedPath) {
    return { kind: "extract_file", storedPath: source.storedPath };
  }
  return { kind: "missing_file" };
}
