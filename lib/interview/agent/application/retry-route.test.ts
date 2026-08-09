import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const routePath = new URL(
  "../../../../app/api/interviews/[id]/runs/[runId]/retry/route.ts",
  import.meta.url,
);

test("failed-run retry route enforces ownership and delegates replacement", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /getCurrentUserId/);
  assert.match(source, /interviewResumeSnapshots\.ownerUserId/);
  assert.match(source, /owned\.status !== "active"/);
  assert.match(source, /retryFailedAgentRun/);
  assert.match(source, /status: 202/);
  assert.match(source, /knownConflictCodes\.has\(errorCode\) \? 409 : 500/);
});
