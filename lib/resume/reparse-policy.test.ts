import assert from "node:assert/strict";
import test from "node:test";
import { planResumeReparse } from "./reparse-policy";

test("rejects generated resumes before considering short extracted text", () => {
  assert.deepEqual(
    planResumeReparse({
      sourceType: "generated",
      extractedText: "short",
      storedPath: null,
    }),
    { kind: "unsupported_source" },
  );
});

test("rejects generated resumes before considering long extracted text", () => {
  assert.deepEqual(
    planResumeReparse({
      sourceType: "generated",
      extractedText: "x".repeat(100),
      storedPath: null,
    }),
    { kind: "unsupported_source" },
  );
});

test("preserves uploaded resume text and file reparse paths", () => {
  assert.deepEqual(
    planResumeReparse({
      sourceType: "uploaded",
      extractedText: "x".repeat(100),
      storedPath: "resume.pdf",
    }),
    { kind: "parse_text", extractedText: "x".repeat(100) },
  );
  assert.deepEqual(
    planResumeReparse({
      sourceType: "uploaded",
      extractedText: "short",
      storedPath: "resume.pdf",
    }),
    { kind: "extract_file", storedPath: "resume.pdf" },
  );
});
