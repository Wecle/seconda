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

test("accepts multiple question clauses and questions in acknowledgement", () => {
  for (const input of [
    {
      acknowledgement: "你为什么这样做？这个取舍值得继续展开。",
      question: "为什么失败？怎么恢复？如何验证？",
      claims: [{ text: "这样做", sourceIds: ["answer:12"] }],
    },
    {
      acknowledgement: "回答很好。",
      question: "请围绕失败、恢复和验证说明你的处理思路",
      claims: [],
    },
  ]) {
    assert.equal(groundedResponsePlanSchema.safeParse(input).success, true);
  }
});
