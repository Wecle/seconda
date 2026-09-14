import assert from "node:assert/strict";
import test from "node:test";
import {
  interviews,
  interviewJobSnapshots,
  resumeJobDescriptions,
} from "./schema";

test("schema exports resumeJobDescriptions and interviewJobSnapshots tables", () => {
  assert.ok(resumeJobDescriptions, "resumeJobDescriptions table should be exported");
  assert.ok(interviewJobSnapshots, "interviewJobSnapshots table should be exported");
  assert.ok(interviews.jobSnapshotId, "interviews table should have jobSnapshotId column");
});
