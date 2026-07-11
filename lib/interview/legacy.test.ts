import assert from "node:assert/strict";
import test from "node:test";
import { legacyInterviewReadOnlyResponse } from "./legacy";

test("retires legacy interview mutations with Gone", async () => {
  const response = legacyInterviewReadOnlyResponse();
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /read-only/);
});
