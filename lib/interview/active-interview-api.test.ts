import test from "node:test";
import assert from "node:assert/strict";

test("GET /api/interviews/active returns 401 when unauthorized", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not configured");
    return;
  }
  const { GET } = await import("@/app/api/interviews/active/route");
  const response = await GET();
  assert.equal(response.status, 401);
  const data = await response.json();
  assert.equal(data.error, "Unauthorized");
});
