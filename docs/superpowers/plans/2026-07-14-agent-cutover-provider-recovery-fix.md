# Agent Cutover Provider Recovery Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 DeepSeek Agent 工具流被错误强制为 JSON Object，以及 PostgreSQL 可恢复失败终态无法写入退避时间的问题，使现有 cutover Run 可安全恢复并幂等收敛。

**Architecture:** Provider 工厂新增显式 `structured`/`conversational` 请求模式，共享 endpoint、鉴权和模型适配，但只为结构化任务启用 JSON response format。失败终态继续在单个 PostgreSQL 事务中提交，退避基准时间改由数据库 `CURRENT_TIMESTAMP` 产生，避免原始 SQL 绑定 JavaScript `Date`。

**Tech Stack:** TypeScript strict、Vercel AI SDK 7、`@ai-sdk/openai-compatible`、Drizzle ORM、`postgres`、PostgreSQL、Node test runner、pnpm。

## Global Constraints

- PostgreSQL-only；不增加 SQLite、内存生产后端或其他持久化路径。
- 不改变面试状态机、六维评分、覆盖度规则、问题上限或完成条件。
- 不改变公开推理、proposal authorization、safe-tail 或原子消息提交协议。
- 不新增 Runtime 版本、feature flag、灰度或 legacy 写入回退。
- 不删除或手工改写历史面试、Run、事件、消息或快照。
- DeepSeek conversational 模式仍必须发送 `thinking: { type: "disabled" }`。
- 所有 `createProviderModel` 生产调用必须显式声明请求模式，不提供默认值。

## File Map

| File | Responsibility |
|---|---|
| `lib/ai/provider-registry.ts` | Provider 请求模式、DeepSeek request transform、结构化输出元数据 |
| `lib/ai/provider-registry.test.ts` | 捕获真实 Provider 请求体并验证两种模式 |
| `lib/ai/generate-structured.ts` | 结构化生成调用显式选择 `structured` |
| `lib/ai/generate-structured.test.ts` | 结构化错误/重试 fixture 显式选择 `structured` |
| `scripts/ai-live-contract.ts` | 付费结构化 live contract 显式选择 `structured` |
| `lib/interview/agent/model-port.ts` | Agent `streamText + tools` 显式选择 `conversational` |
| `lib/interview/agent/repository.ts` | PostgreSQL 失败终态和恢复退避时间 |
| `lib/interview/agent/repository.integration.test.ts` | 真实 PostgreSQL 可恢复失败原子性与幂等性 |
| `scripts/agent-runtime-cutover.test.ts` | 既有 cutover crash-window 与幂等回归测试 |

---

### Task 1: Separate Structured and Conversational Provider Requests

**Files:**
- Modify: `lib/ai/provider-registry.test.ts`
- Modify: `lib/ai/provider-registry.ts`
- Modify: `lib/ai/generate-structured.ts`
- Modify: `lib/ai/generate-structured.test.ts`
- Modify: `scripts/ai-live-contract.ts`
- Modify: `lib/interview/agent/model-port.ts`

**Interfaces:**
- Consumes: existing `createProviderModel`, `createProviderOutput`, `applyStructuredOutputInstructions`.
- Produces: required `responseMode: "structured" | "conversational"` input on `createProviderModel`.
- Preserves: `ProviderModel`, `ProviderAdapterMetadata`, model policy and credential tier selection.

- [ ] **Step 1: Extend the request-capture test helper with an explicit mode**

Change the helper signature and Provider call in `lib/ai/provider-registry.test.ts`:

```ts
async function requestFor(
  model: string,
  credentialTier: "fast" | "quality",
  apiKey: string,
  responseMode: "structured" | "conversational" = "structured",
) {
  let url = "";
  let authorization = "";
  let body: Record<string, unknown> = {};
  const provider = createProviderModel({
    model,
    credentialTier,
    apiKey,
    responseMode,
    fetch: async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "fixture",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: responseMode === "structured" ? '{"value":"ok"}' : "ok",
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const output = responseMode === "structured"
    ? (await generateText({
        model: provider.model,
        system: "Return JSON.",
        prompt: "fixture",
        maxRetries: 0,
        output: createProviderOutput(schema, provider.metadata),
      })).output
    : (await generateText({
        model: provider.model,
        system: "Return one short sentence.",
        prompt: "fixture",
        maxRetries: 0,
      })).text;

  return { provider, url, authorization, body, output };
}
```

- [ ] **Step 2: Add a failing DeepSeek conversational request test**

Add this test beside the existing DeepSeek structured request test:

```ts
test("DeepSeek conversational requests omit JSON response format and keep hidden thinking disabled", async () => {
  const result = await requestFor(
    "deepseek/deepseek-chat",
    "fast",
    "fast-sentinel",
    "conversational",
  );

  assert.equal("response_format" in result.body, false);
  assert.deepEqual(result.body.thinking, { type: "disabled" });
});
```

Update every `createProviderModel` call in this test file to pass `responseMode: "structured"` when it is not routed through `requestFor`.

- [ ] **Step 3: Run the Provider test and verify the protocol failure**

Run:

```bash
pnpm exec tsx --test lib/ai/provider-registry.test.ts
```

Expected: FAIL because the conversational DeepSeek request still contains `response_format`.

- [ ] **Step 4: Make Provider request mode explicit and condition the DeepSeek transform**

Modify `lib/ai/provider-registry.ts`:

```ts
export type ProviderResponseMode = "structured" | "conversational";

type ProviderRegistryInput = {
  model: string;
  credentialTier: AIModelTier;
  apiKey: string;
  responseMode: ProviderResponseMode;
  fetch?: typeof globalThis.fetch;
};
```

Replace the DeepSeek request transform with:

```ts
transformRequestBody: (body) => ({
  ...body,
  ...(input.responseMode === "structured"
    ? { response_format: { type: "json_object" } }
    : {}),
  thinking: { type: "disabled" },
}),
```

Do not change `createProviderOutput` or `applyStructuredOutputInstructions`; they continue to define structured task behavior.

- [ ] **Step 5: Mark every production and fixture caller with its protocol**

Use structured mode in `lib/ai/generate-structured.ts` for both `invoke` and `stream`:

```ts
const provider = createProviderModel({
  ...candidate,
  apiKey: apiKey!,
  responseMode: "structured",
});
```

Use conversational mode in `lib/interview/agent/model-port.ts`:

```ts
const provider = createProviderModel({
  ...candidate,
  apiKey,
  responseMode: "conversational",
});
```

Use structured mode in `scripts/ai-live-contract.ts` and the direct Provider fixtures in `lib/ai/generate-structured.test.ts`:

```ts
const provider = createProviderModel({
  ...candidate,
  apiKey,
  responseMode: "structured",
});
```

For fixtures with literal model fields, add `responseMode: "structured"` to the existing object without changing their fake fetch behavior.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm exec tsx --test lib/ai/provider-registry.test.ts lib/ai/generate-structured.test.ts lib/interview/agent/model-port.test.ts
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript reports no missing `responseMode` callers.

- [ ] **Step 7: Review the request-body boundary**

Run:

```bash
rg -n "createProviderModel\(" lib scripts
git diff --check
```

Expected: every caller visibly passes `responseMode`; diff check exits 0.

- [ ] **Step 8: Commit the Provider protocol separation**

```bash
git add lib/ai/provider-registry.ts lib/ai/provider-registry.test.ts lib/ai/generate-structured.ts lib/ai/generate-structured.test.ts scripts/ai-live-contract.ts lib/interview/agent/model-port.ts
git commit -m "fix(ai): separate agent and structured provider modes"
```

---

### Task 2: Persist Recoverable Failure Backoff Atomically

**Files:**
- Modify: `lib/interview/agent/repository.integration.test.ts`
- Modify: `lib/interview/agent/repository.ts`

**Interfaces:**
- Consumes: `InterviewAgentRepository.terminateRun(runId, input, lease)` and existing lease fence.
- Produces: recoverable failed Run with non-null `nextResumeAt` until `MAX_AGENT_RUN_RESUMES` is reached.
- Preserves: one transaction for Run state, event sequence, terminal event and PostgreSQL notification.

- [ ] **Step 1: Add real-PostgreSQL assertions for a recoverable terminal failure**

In the existing `real database fences stale workers...` test, after the question/coverage assertions and before `answerEndRace`, terminate the still-leased Run:

```ts
const terminationStartedAt = Date.now();
const expectedBackoffMs = Math.min(
  300_000,
  30_000 * (2 ** secondClaim.run!.resumeCount),
);
const terminated = await repository.terminateRun(runId, {
  exitReason: "aborted_streaming",
  error: new Error("fixture provider failure"),
}, secondLease);

assert.equal(terminated.status, "failed");
assert.equal(terminated.created, true);

const [failedRun] = await db.select({
  status: interviewAgentRuns.status,
  leaseOwner: interviewAgentRuns.leaseOwner,
  leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
  nextResumeAt: interviewAgentRuns.nextResumeAt,
  lastEventSequence: interviewAgentRuns.lastEventSequence,
}).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId));

assert.equal(failedRun.status, "failed");
assert.equal(failedRun.leaseOwner, null);
assert.equal(failedRun.leaseExpiresAt, null);
assert.ok(failedRun.nextResumeAt);
assert.ok(
  Math.abs(
    failedRun.nextResumeAt.getTime()
      - terminationStartedAt
      - expectedBackoffMs,
  ) < 5_000,
);
```

Then verify terminal idempotency:

```ts
const replayedTermination = await repository.terminateRun(runId, {
  exitReason: "aborted_streaming",
  error: new Error("fixture replay"),
}, secondLease);
assert.equal(replayedTermination.created, false);

const terminalEvents = await db.select({
  sequence: interviewAgentEvents.sequence,
  type: interviewAgentEvents.type,
}).from(interviewAgentEvents).where(and(
  eq(interviewAgentEvents.runId, runId),
  eq(interviewAgentEvents.type, "run_failed"),
));
assert.deepEqual(terminalEvents, [{
  sequence: failedRun.lastEventSequence,
  type: "run_failed",
}]);
```

- [ ] **Step 2: Run the PostgreSQL test and verify the Date bind failure**

Run:

```bash
pnpm exec tsx --env-file=.env --test lib/interview/agent/repository.integration.test.ts
```

Expected: FAIL in `terminateRun` with `ERR_INVALID_ARG_TYPE` for a bound `Date`.

- [ ] **Step 3: Replace the JavaScript Date bind with PostgreSQL transaction time**

In `lib/interview/agent/repository.ts`, keep the existing `now` value for typed timestamp columns, but change only the recoverable `nextResumeAt` expression:

```ts
nextResumeAt: !completed && RECOVERABLE_RUN_EXIT_REASONS.includes(input.exitReason)
  ? sql`CASE
      WHEN ${interviewAgentRuns.resumeCount} >= ${MAX_AGENT_RUN_RESUMES}
        THEN NULL
      ELSE CURRENT_TIMESTAMP
        + LEAST(
            300000,
            30000 * POWER(2, ${interviewAgentRuns.resumeCount})
          ) * INTERVAL '1 millisecond'
    END`
  : null,
```

Do not split the Run update and terminal event insert into separate transactions.

- [ ] **Step 4: Run repository unit and PostgreSQL integration tests**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/repository.test.ts
pnpm exec tsx --env-file=.env --test lib/interview/agent/repository.integration.test.ts
```

Expected: both commands PASS; the PostgreSQL test does not skip because `.env` contains `DATABASE_URL`.

- [ ] **Step 5: Run cutover crash-window regression tests**

Run:

```bash
pnpm exec tsx --env-file=.env --test scripts/agent-runtime-cutover.test.ts
```

Expected: all pure and real-PostgreSQL cutover tests PASS, including retrying durable unfinished opening and answer Runs.

- [ ] **Step 6: Commit the failure-terminal fix**

```bash
git add lib/interview/agent/repository.ts lib/interview/agent/repository.integration.test.ts
git commit -m "fix(agent): persist recoverable failure backoff"
```

---

### Task 3: Verify and Resume the Interrupted Cutover

**Files:**
- Verify: `scripts/agent-runtime-cutover.ts`
- Verify: `scripts/interview-agent-contract.ts`
- Verify: `docs/operations/agent-room-ux-checklist.md`

**Interfaces:**
- Consumes: fixed conversational Provider mode and fixed `terminateRun` transaction.
- Produces: recovered active Runs and an idempotently converged PostgreSQL cutover.
- Preserves: current persisted Run/event history; no manual data mutation.

- [ ] **Step 1: Run the complete local quality gate**

Run sequentially:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
git diff --check
```

Expected:

- Unit suite: 0 failures; database-conditional skips are reported explicitly.
- TypeScript: exit 0.
- ESLint: 0 errors; at most the two pre-existing warnings.
- Production build: exit 0.
- Diff check: exit 0.

- [ ] **Step 2: Inspect the interrupted Run without mutating it**

Query Run `ebd264e6-b6c6-499b-bb40-7b68a2cffd67` using the existing Drizzle connection:

```bash
pnpm exec tsx --env-file=.env -e 'import { eq } from "drizzle-orm"; import { db } from "./lib/db/index.ts"; import { interviewAgentEvents, interviewAgentRuns } from "./lib/db/schema.ts"; void (async () => { const runId = "ebd264e6-b6c6-499b-bb40-7b68a2cffd67"; const [run] = await db.select().from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId)); const events = await db.select({ type: interviewAgentEvents.type }).from(interviewAgentEvents).where(eq(interviewAgentEvents.runId, runId)); process.stdout.write(JSON.stringify({ run, eventTypes: events.map((event) => event.type) }, null, 2)); process.exit(0); })();'
```

Assert:

```text
streamMode = durable_provisional
status = running
leaseOwner = null
leaseExpiresAt = null
no message_committed event
no run_completed event
```

Expected: the Run remains eligible for cutover recovery. If it has already completed through another worker, skip direct recovery assertions and continue with the idempotency run.

- [ ] **Step 3: Execute the real cutover once**

Run:

```bash
pnpm agent:cutover
```

Expected: exit 0 with JSON containing `completed` and `resumed` arrays. The interrupted Run either appears in `resumed` or is already terminal because another current worker completed it.

- [ ] **Step 4: Verify every resumed Run reached a valid durable state**

For every Run ID printed under `resumed`, query PostgreSQL and assert one of:

```text
status = completed and exactly one run_completed event
status = failed and exactly one run_failed event and recoverable failures have nextResumeAt
status = running and leaseExpiresAt is in the future
```

Also assert no Run contains more than one `message_committed` event for the same logical message.

- [ ] **Step 5: Execute cutover a second time to prove idempotency**

Run:

```bash
pnpm agent:cutover
```

Expected after all external model calls have settled:

```json
{"completed":[],"resumed":[]}
```

If a recoverable provider failure is still inside its backoff window, record that external condition and rerun after `nextResumeAt`; do not weaken the assertions or edit the Run manually.

- [ ] **Step 6: Run the optional paid Agent live contract when configured**

Run:

```bash
INTERVIEW_AGENT_TEST_RESUME_VERSION_ID=19273f38-213b-40d0-8ae3-10bd92fcd3b2 pnpm test:interview:agent
pnpm test:interview:failure
```

Expected: both commands exit 0. The first command creates a persistent test interview and incurs real model usage; the second is deterministic and in-memory.

- [ ] **Step 7: Final clean-tree review**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: working tree clean and the two implementation commits appear after the design/plan commits. If an acceptance assertion fails, return to the task that owns that assertion, add a failing regression test there, repair it, and amend that task with a new focused commit; do not create an empty acceptance commit.
