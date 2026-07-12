import assert from "node:assert/strict";
import test from "node:test";
import { composeCandidateResponse, groundedResponsePlanSchema, validateGroundedClaims } from "./grounding";

const sources = new Map([
  ["answer:12", "我将查询键设计为列表、详情、关联三层，并统一失效关联键。"],
  ["resume:project", "负责智能审批项目的前端开发。"],
]);

test("rejects an unsupported team-size attribution", () => {
  const result = validateGroundedClaims({
    acknowledgement: "你提到团队有四人。",
    question: "你如何与后端协作？",
    claims: [{ text: "团队有4人", sourceIds: ["resume:project"] }],
  }, sources);
  assert.deepEqual(result, { ok: false, unsupportedClaims: ["团队有4人", "你提到团队有四人"] });
});

test("accepts grounded acknowledgement followed by exactly one question", () => {
  const plan = groundedResponsePlanSchema.parse({
    acknowledgement: "你说明了查询键分层和统一失效策略。",
    question: "回滚失败时你如何保证最终一致性？",
    claims: [{ text: "查询键设计为列表、详情、关联三层", sourceIds: ["answer:12"] }],
  });
  assert.deepEqual(validateGroundedClaims(plan, sources), { ok: true });
  assert.equal(composeCandidateResponse(plan).endsWith("最终一致性？"), true);
});

test("rejects multiple questions and acknowledgement without sources", () => {
  assert.equal(groundedResponsePlanSchema.safeParse({ acknowledgement: "回答很好。", question: "为什么？怎么做？", claims: [] }).success, false);
  assert.equal(groundedResponsePlanSchema.safeParse({ acknowledgement: "你为什么这样做？", question: "请说明原因？", claims: [{ text: "这样做", sourceIds: ["answer:12"] }] }).success, false);
});

test("allows non-factual evaluation and question facts from explicit resume evidence", () => {
  const result = validateGroundedClaims({
    acknowledgement: "这是一个很有意思的方向。",
    question: "可以介绍一下你在 Overlord AI 项目中具体承担的角色吗？",
    claims: [],
    resumeEvidenceIds: ["project:overlord"],
  }, new Map([["project:overlord", "Overlord AI 项目使用 Next.js 构建。"]]));
  assert.deepEqual(result, { ok: true });
});

test("rejects undeclared facts even when claims is empty", () => {
  assert.deepEqual(validateGroundedClaims({ acknowledgement: "你负责了一个四人 React 团队。", question: "你如何协作？", claims: [] }, sources), {
    ok: false,
    unsupportedClaims: ["你负责了一个四人 React 团队"],
  });
});

test("rejects unsupported facts piggybacking on a valid technology claim", () => {
  const result = validateGroundedClaims({
    acknowledgement: "你领导了一个四人 React 团队。",
    question: "请介绍一次协作冲突？",
    claims: [{ text: "React", sourceIds: ["resume:project"] }],
  }, new Map([["resume:project", "使用 React 开发智能审批项目。"]]));
  assert.equal(result.ok, false);
});

test("rejects unsupported company and responsibility presuppositions in questions", () => {
  const result = validateGroundedClaims({ acknowledgement: "", question: "你在 Google 负责支付平台时遇到的最大挑战是什么？", claims: [] }, sources);
  assert.equal(result.ok, false);
});

test("matches Chinese year numerals and harmless candidate attribution", () => {
  const source = new Map([["resume:profile", "三年前端开发经验，熟练使用 React、Vue 等框架及生态工具。"]]);
  const result = validateGroundedClaims({
    acknowledgement: "候选人拥有3年前端开发经验，熟悉React和Vue等框架。",
    question: "请介绍一下你的前端项目经验？",
    claims: [
      { text: "候选人拥有3年前端开发经验", sourceIds: ["resume:profile"] },
      { text: "候选人熟悉React和Vue等框架", sourceIds: ["resume:profile"] },
    ],
  }, source);
  assert.deepEqual(result, { ok: true });
});

test("allows grounded answer acknowledgement and an exploratory project question", () => {
  const answerId = "answer:ca52fc89-0988-4bf0-852e-4b05bd8896c6";
  const sources = new Map([
    [answerId, "我主要负责 Seconda 的前端和 AI 面试流程设计，重点解决可靠性与上下文管理。"],
    ["project:approval", "云之家智能审批/公文管理，使用 Vue2.6、Vuex 和 Vue Router。"],
  ]);
  const result = validateGroundedClaims({
    acknowledgement: "你提到负责 Seconda 的前端和 AI 面试流程设计；简历中有云之家智能审批项目经验。",
    question: "请介绍一个你主导或深度参与的前端项目，比如云之家智能审批模块，你具体承担了哪些职责？",
    claims: [
      { text: "候选人负责 Seconda 的前端和 AI 面试流程设计", sourceIds: [answerId] },
      { text: "简历中有云之家智能审批项目经验", sourceIds: ["project:approval"] },
    ],
  }, sources);
  assert.deepEqual(result, { ok: true });
});
