# Agent Question Validation Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove punctuation- and clause-count validation from `ask` and `clarify` responses while retaining structured interview policy, finish-action consistency, safety, language, grounding, and production recovery guarantees.

**Architecture:** The structured `decision` remains authoritative for one action, category, intent, and coverage target. Candidate-visible wording is natural language and is no longer reverse-engineered through question-mark counts or compound-question regexes. The existing single Agent loop, authorized provisional streaming, PostgreSQL event persistence, and bounded repair flow remain unchanged.

**Tech Stack:** TypeScript strict mode, Node test runner through `tsx`, Zod 4, Vercel AI SDK 7, Next.js 16, PostgreSQL/Drizzle

## Global Constraints

- Keep the current single Agent loop; do not add a fixed Planner, Renderer, or Critic call.
- Keep PostgreSQL as the only durable Run and event source; do not add Redis, Kafka, or a new queue.
- Do not change database schemas, migrations, environment variables, SSE event types, or cutover behavior.
- Do not change the six-dimension scoring model, resume snapshot semantics, category limit of 3, candidate-answer limit of 20, or completion policy.
- `ask` and `clarify` text may contain zero, one, or multiple question marks, question clauses, and bounded answer hints.
- A Run must still contain exactly one structured `decision.action`, `decision.category`, `decision.intent`, and `coverageTarget` for `ask` or `clarify`.
- Keep `FINISH_ASKS_QUESTION` as an action-consistency guard.
- Keep response length, protocol leakage, sensitive content, formal scoring, language, and grounding validation.
- Do not retain V1/V2/V3 branches or introduce a rollout flag.

---

### Task 1: Align the product contract and approved specification

**Files:**
- Modify: `/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md`
- Reference: `docs/superpowers/specs/2026-07-16-agent-question-validation-boundary-design.md`

**Interfaces:**
- Consumes: Existing PRD §7.2 Agent interview rules.
- Produces: The authoritative definition that one turn means one structured action and core objective, not one interrogative sentence.

- [ ] **Step 1: Add the approved rule to PRD §7.2**

Insert immediately after the bullet describing deterministic application-policy validation:

```markdown
- “每轮一个问题”指每轮只有一个结构化行动、一个问题分类和一个核心考察意图；候选人可见文本可以包含多个疑问句、回答提示或拆解维度，不按问号、疑问词或连接词数量判定是否合法
```

- [ ] **Step 2: Verify documentation consistency**

Run:

```bash
rg -n "每轮一个问题|状态：" '/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md' docs/superpowers/specs/2026-07-16-agent-question-validation-boundary-design.md
git diff --check
```

Expected: PRD reports the structured definition; the spec reports `已批准`; whitespace validation exits with code 0.

- [ ] **Step 3: Commit the product contract**

```bash
git add '/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md'
git commit -m "docs(agent): align question validation contract"
```

Expected: one PRD-only commit.

---

### Task 2: Remove question-count validation from response and grounding schemas

**Files:**
- Modify: `lib/interview/agent/response-validator.test.ts`
- Modify: `lib/interview/agent/response-validator.ts`
- Modify: `lib/interview/agent/grounding.test.ts`
- Modify: `lib/interview/agent/grounding.ts`

**Interfaces:**
- Consumes: `validateFinalResponse`, `validateResponseProgress`, and `groundedResponsePlanSchema`.
- Produces: The same public functions and response-plan shape; `ResponseValidationResult` no longer exposes `MULTIPLE_QUESTIONS`, and `question` accepts any non-empty prompt up to 500 characters.

- [ ] **Step 1: Write validator regressions for the approved behavior**

Remove `"为什么这样做？如何验证？"` from the unsafe-progress loop. Add:

```ts
test("allows multiple question clauses and declarative prompts for one structured action", () => {
  for (const input of [
    { language: "zh" as const, text: "你会怎样设计这条监控链路？采集怎么做？上报和分析为什么这样取舍？" },
    { language: "en" as const, text: "What failed, and how did you recover? How did you verify the result?" },
    { language: "es" as const, text: "Explica el diseño, cómo lo validaste y qué cambiarías." },
    { language: "de" as const, text: "Beschreiben Sie den Entwurf und wie Sie das Ergebnis geprüft haben." },
    { language: "zh" as const, text: "请围绕监控链路说明采集、上报和分析的设计" },
  ]) {
    assert.deepEqual(validateFinalResponse({
      action: "ask",
      language: input.language,
      text: input.text,
      allowedTerms: [],
    }), { ok: true }, input.text);
  }
});
```

Replace the compound-question rejection test with:

```ts
test("rejects candidate prompts when the structured action is finish", () => {
  for (const input of [
    { language: "en" as const, text: "Please tell me more about the project." },
    { language: "en" as const, text: "Thank you. Please tell me more about the project." },
    { language: "zh" as const, text: "面试结束。请介绍更多。" },
  ]) {
    const result = validateFinalResponse({
      action: "finish",
      language: input.language,
      text: input.text,
      allowedTerms: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FINISH_ASKS_QUESTION");
  }
});
```

Change the existing grounded-final-text test so `"为什么？如何处理？"` is expected to return `{ ok: true }`; retain its formal-score and finish assertions.

- [ ] **Step 2: Replace grounding rejection tests with acceptance tests**

Replace the second test in `grounding.test.ts` with:

```ts
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
```

- [ ] **Step 3: Run focused tests and confirm the old behavior fails**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/response-validator.test.ts lib/interview/agent/grounding.test.ts
```

Expected: FAIL because the current validator returns `MULTIPLE_QUESTIONS` and the current grounding schema rejects the new fixtures.

- [ ] **Step 4: Remove `MULTIPLE_QUESTIONS` and compound-question logic**

In `response-validator.ts`:

1. Remove `"MULTIPLE_QUESTIONS"` from `ResponseValidationResult`.
2. Keep the finish guard in both `validateFinalResponse` and `validateResponse`.
3. Delete the `ask` / `clarify` branches that inspect question count or compound syntax.
4. Delete `hasCompoundQuestion`.
5. Keep `countQuestions` and `startsWithQuestionIntent` for `FINISH_ASKS_QUESTION`.

The final response action block becomes:

```ts
const questionCount = countQuestions(input.text);
if (input.action === "finish" && (questionCount > 0 || startsWithQuestionIntent(input.text))) {
  return invalid("FINISH_ASKS_QUESTION", "结束语不得继续提问。");
}

return { ok: true };
```

The shared progress/final validation keeps the same finish block and then continues directly to `findUnauthorizedTerm`.

- [ ] **Step 5: Relax only punctuation constraints in grounding**

Change the top of `grounding.ts` to:

```ts
export const acknowledgementSchema = z.string().trim().max(600).default("");
export const candidatePromptSchema = z.string().trim().min(1).max(500);
export const groundedClaimsSchema = z.array(groundedClaimSchema).max(10).default([]);

export const groundedResponsePlanSchema = z.object({
  acknowledgement: acknowledgementSchema,
  question: candidatePromptSchema,
  claims: groundedClaimsSchema,
}).strict();
```

Delete `singleQuestionSchema` and `hasExactlyOneQuestion`. Keep the external `question` property name so response-plan consumers do not change.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/response-validator.test.ts lib/interview/agent/grounding.test.ts
npx tsc --noEmit
```

Expected: all focused tests pass and TypeScript exits with code 0.

- [ ] **Step 7: Commit validator and schema changes**

```bash
git add lib/interview/agent/response-validator.ts lib/interview/agent/response-validator.test.ts lib/interview/agent/grounding.ts lib/interview/agent/grounding.test.ts
git commit -m "fix(agent): remove question count validation"
```

Expected: one commit containing only validation and grounding behavior.

---

### Task 3: Align model instructions and prove the Runtime no longer retracts valid wording

**Files:**
- Modify: `lib/interview/agent/turn-proposal.ts`
- Modify: `lib/interview/agent/tool-registry.test.ts`
- Modify: `lib/interview/agent/model-port.ts`
- Modify: `lib/interview/agent/model-port.test.ts`
- Modify: `lib/interview/agent/skills.ts`
- Modify: `lib/interview/agent/runtime.ts`
- Modify: `lib/interview/agent/runtime.test.ts`

**Interfaces:**
- Consumes: `RESPONSE_TEXT_SCHEMA_DESCRIPTION`, `AGENT_SYSTEM_PROMPT`, active skill instructions, `repairGuidance`, and Runtime public events.
- Produces: Prompt contracts centered on one structured interview intent and a Runtime path that commits multi-clause prompts without repair or `response_discarded`.

- [ ] **Step 1: Write prompt contract tests for the new semantics**

Replace question-count assertions in `tool-registry.test.ts` with:

```ts
assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /ask\/clarify.*一个核心考察意图/);
assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /回答提示.*多个疑问句/);
assert.doesNotMatch(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /只能包含一个疑问句|只能出现一个.*[?？]/);
assert.match(RESPONSE_TEXT_SCHEMA_DESCRIPTION, /finish.*不得邀请候选人继续作答/);
```

Update its role-clarification assertion to match `围绕岗位方向澄清这一核心意图` instead of `一个岗位方向澄清问题`.

Replace corresponding assertions in `model-port.test.ts` with:

```ts
assert.match(AGENT_SYSTEM_PROMPT, /ask 或 clarify.*一个核心考察意图/);
assert.match(AGENT_SYSTEM_PROMPT, /回答提示.*多个疑问句/);
assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /只能包含一个疑问句|只能出现一个.*[?？]/);
assert.match(AGENT_SYSTEM_PROMPT, /finish.*不得邀请候选人继续作答/);
```

- [ ] **Step 2: Replace the Runtime rollback regression with a commit-once regression**

Replace `discards a visible response before repair` in `runtime.test.ts` with:

```ts
test("commits a multi-clause response without repair or retraction", async () => {
  const proposal = openingProposal({
    responseText: "你为什么选择这个方向？希望解决什么问题？准备如何验证结果？",
  });
  const fixture = await createRuntimeFixture({
    model: scriptedModel([
      streamingTerminalScript({ proposal, chunks: [proposal.responseText] }),
    ]),
  });

  const result = await runInterviewAgent(fixture.runOptions);

  assert.equal(result.exitReason, "completed");
  const events = await fixture.publicEvents();
  assert.equal(events.some((event) => event.type === "response_discarded"), false);
  assert.equal(events.filter((event) => event.type === "response_started").length, 1);
  const snapshot = fixture.repository.inspectInterview("interview");
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].content, proposal.responseText);
});
```

- [ ] **Step 3: Run focused tests and confirm old instructions fail**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.test.ts lib/interview/agent/runtime.test.ts
```

Expected: FAIL because the current prompt strings enforce one interrogative sentence and the current Runtime retracts the fixture.

- [ ] **Step 4: Update terminal tool description**

Replace `RESPONSE_TEXT_SCHEMA_DESCRIPTION` in `turn-proposal.ts` with:

```ts
export const RESPONSE_TEXT_SCHEMA_DESCRIPTION =
  "候选人可见回复，必须作为最后一个字段生成。decision.action 为 ask/clarify 时，必须围绕 decision 中的一个核心考察意图，可以包含必要解释、回答提示或多个疑问句，但不得切换到无关主题；decision.action 为 finish 时不得邀请候选人继续作答。开场必须简洁并按岗位判断分支处理：岗位方向置信度足够且 decision.action 为 ask 时，包含简短问候、推断的岗位或方向和自我介绍邀请；岗位方向置信度不足或 decision.action 为 clarify 时，只围绕岗位方向澄清这一核心意图，并暂缓自我介绍邀请，待方向确认后再邀请。两种分支均不得枚举或复述简历。";
```

- [ ] **Step 5: Update system prompt and active skill instruction**

In `AGENT_SYSTEM_PROMPT`, replace only the question-style portion while preserving existing public reasoning, language, persona, assessment, evidence, scoring, and protocol rules:

```text
开场 responseText 必须简洁并按岗位判断分支处理：岗位方向置信度足够且 decision.action 为 ask 时，包含简短问候、基于简历推断的岗位或方向和自我介绍邀请；岗位方向置信度不足或 decision.action 为 clarify 时，只围绕岗位方向澄清这一核心意图，并暂缓自我介绍邀请，待方向确认后再邀请。两种分支均不得枚举或复述简历。decision.action 为 ask 或 clarify 时，responseText 必须围绕 decision 中的一个核心考察意图，可以包含必要解释、回答提示或多个疑问句，但不得切换到无关主题。decision.action 为 finish 时不得邀请候选人继续作答。
```

Change `answer-planning` in `skills.ts` to:

```ts
instructions: "基于最新回答和已注入覆盖度，在 submit_interview_turn 中同时提交无分数轻量评估、覆盖度变化和一个追问、新主题或结束行动。不得生成正式分数。responseText 必须围绕本轮唯一的结构化核心考察意图，可以包含必要的回答提示，但不得切换到无关主题；评价只复述已确认内容，不做人格判断。",
```

- [ ] **Step 6: Remove obsolete Runtime repair guidance**

In `runtime.ts`, replace the combined question repair branch with:

```ts
if (code === "FINISH_ASKS_QUESTION") {
  return "finish 不得邀请候选人继续作答。";
}
```

There must be no `MULTIPLE_QUESTIONS` branch or guidance about one question mark, connector words, or subquestions.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.test.ts lib/interview/agent/runtime.test.ts
```

Expected: all focused tests pass; the Runtime reports one committed message and no `response_discarded` event.

- [ ] **Step 8: Scan for obsolete constraints**

Run:

```bash
rg -n "MULTIPLE_QUESTIONS|只能包含一个疑问句|只能出现一个.*[?？]|hasCompoundQuestion|hasExactlyOneQuestion|singleQuestionSchema" lib/interview/agent
```

Expected: no matches in production or test code.

- [ ] **Step 9: Run complete verification**

Run:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
git diff --check
```

Expected: tests, typecheck, lint, build, and whitespace validation all exit with code 0. No database or live-provider contract command is required because there is no persistence or provider-schema shape migration.

- [ ] **Step 10: Commit prompt and Runtime integration**

```bash
git add lib/interview/agent/turn-proposal.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.ts lib/interview/agent/model-port.test.ts lib/interview/agent/skills.ts lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts
git commit -m "fix(agent): trust structured question intent"
```

Expected: one commit containing prompt, Runtime recovery, and integration-test changes.

- [ ] **Step 11: Confirm final repository state**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: clean worktree and three new implementation commits after the plan/spec commit. Deployment requires only the normal application deployment; `pnpm agent:cutover` and `pnpm db:migrate` are not required.
