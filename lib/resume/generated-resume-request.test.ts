import assert from "node:assert/strict";
import test from "node:test";
import { parseGeneratedResumeRequestBody } from "./generated-resume-request";

test("rejects malformed JSON as an invalid request body", async () => {
  const result = await parseGeneratedResumeRequestBody(new Request(
    "http://localhost/api/resumes/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"targetRole":',
    },
  ));

  assert.deepEqual(result, { success: false });
});

test("rejects valid JSON that does not satisfy the generator schema", async () => {
  const result = await parseGeneratedResumeRequestBody(new Request(
    "http://localhost/api/resumes/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "not-a-uuid",
        locale: "zh",
        targetRole: "",
        coreSkills: "",
      }),
    },
  ));

  assert.equal(result.success, false);
  assert.equal(
    result.success ? false : typeof result.details === "object",
    true,
  );
});
