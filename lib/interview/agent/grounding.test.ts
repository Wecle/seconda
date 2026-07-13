import assert from "node:assert/strict";
import test from "node:test";
import { composeCandidateResponse, groundedResponsePlanSchema } from "./grounding";

test("accepts paraphrased acknowledgement with declared sources", () => {
  const plan = groundedResponsePlanSchema.parse({
    acknowledgement: "你说明了缓存键的分层与统一失效思路。",
    question: "回滚失败时你如何保证最终一致性？",
    claims: [{ text: "缓存键采用分层设计", sourceIds: ["answer:12"] }],
  });
  assert.equal(composeCandidateResponse(plan), `${plan.acknowledgement}\n\n${plan.question}`);
});

test("still rejects multiple questions and questions in acknowledgement", () => {
  assert.equal(groundedResponsePlanSchema.safeParse({
    acknowledgement: "回答很好。",
    question: "为什么？怎么做？",
    claims: [],
  }).success, false);
  assert.equal(groundedResponsePlanSchema.safeParse({
    acknowledgement: "你为什么这样做？",
    question: "请说明原因？",
    claims: [{ text: "这样做", sourceIds: ["answer:12"] }],
  }).success, false);
});
