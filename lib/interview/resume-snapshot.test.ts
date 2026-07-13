import assert from "node:assert/strict";
import test from "node:test";
import { createResumeSnapshotPayload, selectDeletableResumeAttachments } from "./resume-snapshot";

test("copies all interview resume fields and detaches structured data from later edits", () => {
  const parsedJson = { name: "Candidate", skills: ["TypeScript"] };
  const snapshot = createResumeSnapshotPayload({
    ownerUserId: "user",
    resumeTitle: "Frontend CV",
    versionNumber: 3,
    originalFilename: "resume.pdf",
    storedPath: "https://blob.example/resume.pdf",
    mimeType: "application/pdf",
    fileSize: 123,
    extractedText: "original text",
    parsedJson,
    parseStatus: "parsed",
  });
  parsedJson.skills.push("Rust");
  assert.deepEqual(snapshot.parsedJson, { name: "Candidate", skills: ["TypeScript"] });
  assert.equal(snapshot.resumeTitle, "Frontend CV");
  assert.equal(snapshot.versionNumber, 3);
  assert.equal(snapshot.storedPath, "https://blob.example/resume.pdf");
});

test("retains snapshot-referenced attachments when a source resume is deleted", () => {
  assert.deepEqual(
    selectDeletableResumeAttachments(
      ["kept.pdf", "unused.pdf", "unused.pdf"],
      ["kept.pdf"],
    ),
    ["unused.pdf"],
  );
});
