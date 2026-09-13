import test from "node:test";
import assert from "node:assert/strict";

test("loadOwnedInterviewResumeSnapshot returns null for non-existent interview", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not configured");
    return;
  }
  const { loadOwnedInterviewResumeSnapshot } = await import("./persistence/repository");
  const { db } = await import("@/lib/db");
  const result = await loadOwnedInterviewResumeSnapshot({
    database: db,
    userId: "00000000-0000-0000-0000-000000000000",
    interviewId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(result, null);
});
