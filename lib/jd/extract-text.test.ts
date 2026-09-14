import assert from "node:assert/strict";
import test from "node:test";
import { extractJobDescriptionText, normalizeJdText } from "./extract-text";

test("normalizeJdText cleans whitespace, control characters and empty lines", () => {
  const dirty = "  岗位职责：\r\n\r\n\t1. 负责后端架构设计。  \n\n\n\n2. 具备分布式经验。\u00A0";
  const clean = normalizeJdText(dirty);
  assert.equal(clean, "岗位职责：\n\n1. 负责后端架构设计。\n\n2. 具备分布式经验。");
});

test("extractJobDescriptionText extracts plain text input directly", async () => {
  const input = "后端工程师 JD 内容";
  const text = await extractJobDescriptionText({ text: input });
  assert.equal(text, input);
});

test("extractJobDescriptionText rejects unsupported file types", async () => {
  await assert.rejects(
    async () => {
      await extractJobDescriptionText({
        buffer: Buffer.from("fake image"),
        mimeType: "image/png",
        filename: "test.png",
      });
    },
    { message: /Unsupported file format/ }
  );
});

test("extractJobDescriptionText rejects empty text", async () => {
  await assert.rejects(
    async () => {
      await extractJobDescriptionText({ text: "   \n\t  " });
    },
    { message: /Job description text cannot be empty/ }
  );
});

test("extractJobDescriptionText rejects text exceeding 8000 characters", async () => {
  await assert.rejects(
    async () => {
      await extractJobDescriptionText({ text: "A".repeat(8001) });
    },
    { message: /exceeds 8000 characters limit/ }
  );
});

test("extractJobDescriptionText rejects buffers exceeding 1MB", async () => {
  const largeBuffer = Buffer.alloc(1 * 1024 * 1024 + 1);
  await assert.rejects(
    async () => {
      await extractJobDescriptionText({
        buffer: largeBuffer,
        mimeType: "application/pdf",
        filename: "large.pdf",
      });
    },
    { message: /File size exceeds 1MB limit/ }
  );
});
