import assert from "node:assert/strict";
import test from "node:test";
import { artifactCommittedPayloadSchema, thinkingSummaryPayloadSchema } from "./contracts";
import { publicArtifactFromToolCompletion } from "./public-events";

test("accepts bounded public thinking without raw reasoning", () => {
  const value = thinkingSummaryPayloadSchema.parse({ entryId: "a", stage: "assessment", summary: "正在判断回答证据。" });
  assert.equal("reasoning" in value, false);
});

test("requires stable artifact identity and maps only whitelisted tools", () => {
  assert.equal(artifactCommittedPayloadSchema.safeParse({ type: "background_saved", title: "背景已保存", summary: "已保存" }).success, false);
  assert.equal(publicArtifactFromToolCompletion({ toolName: "get_interview_history", runId: "r", callId: "c" }), null);
  assert.equal(publicArtifactFromToolCompletion({ toolName: "update_coverage", runId: "r", callId: "c" })?.title, "背景已保存");
});
