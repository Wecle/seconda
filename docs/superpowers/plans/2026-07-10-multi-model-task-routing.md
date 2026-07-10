# Multi-Model Task Routing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route simple Seconda AI tasks to fast models and quality-sensitive tasks to larger models through Vercel AI Gateway without exposing provider details to business code.

**Architecture:** A pure policy module maps each AI task to an ordered model candidate list. A shared structured-generation layer owns deadlines, one repair attempt for malformed structured output, and application-level model fallback; Vercel AI Gateway continues to route each requested model across available providers.

**Tech Stack:** TypeScript 5, Node 20 test runner through `tsx`, Next.js 16 Route Handlers, AI SDK 6, Zod 4, Vercel AI Gateway

**Design reference:** `docs/plans/2026-07-10-multi-model-routing-design.md`

---

## Scope

This plan implements the first independently releasable slice: fixed task tiers, startup configuration validation, ordered model candidates, non-streaming repair and fallback, bounded execution time, streaming Gateway fallback, and migration of every current AI call.

The following are separate projects because they change independent subsystems and require additional product decisions: interview-level model and Prompt snapshots, `creating`/`failed` lifecycle and idempotency, deterministic report aggregation, persistent AI call auditing, and automated golden-dataset evaluation.

## File Map

- Create `lib/ai/model-policy.ts`: task names, tier mapping, validated environment configuration, and ordered candidates.
- Create `lib/ai/model-policy.test.ts`: policy validation, task mapping, and fallback-order tests.
- Create `lib/ai/model-fallback.ts`: provider-independent candidate execution and repair/fallback control flow.
- Create `lib/ai/model-fallback.test.ts`: repair, fallback, fatal-error, and abort tests.
- Create `lib/ai/model-errors.ts`: AI SDK and Gateway error classification without environment access.
- Create `lib/ai/generate-structured.ts`: AI SDK adapters, total deadline, structured generation, and streaming.
- Create `lib/ai/generate-structured.test.ts`: injected adapter tests for candidate order, repair, deadline, validation, and streaming settings.
- Create `lib/ai/task-usage.test.ts`: source-level contract tests for every current business task mapping.
- Create `instrumentation.ts`: added with final configuration in Chunk 4 to validate the approved policy at Node.js startup.
- Modify `lib/resume/parse-resume.ts`: use `resume.parse`.
- Modify `lib/interview/index.ts`: use the six interview task identifiers.
- Modify `app/api/interviews/[id]/next-question/route.ts`: use streamed `question.generate`.
- Delete `lib/ai/chat-provider.ts`: remove OpenAI-specific provider construction.
- Modify `.env.example`, `README.md`, `package.json`, and `pnpm-lock.yaml`: Gateway configuration, test command, and dependency cleanup.

## Chunk 1: Routing Foundation

### Task 1: Add a discoverable test command and validated task policy

**Files:**
- Modify: `package.json`
- Create: `lib/ai/model-policy.test.ts`
- Create: `lib/ai/model-policy.ts`

- [ ] **Step 1: Add an explicit test glob**

Add this script to `package.json` so Node 20 cannot return a false-green zero-test run:

```json
"test": "tsx --test lib/ai/*.test.ts"
```

- [ ] **Step 2: Write the failing policy tests**

Create `lib/ai/model-policy.test.ts` with tests for:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  getTaskTier,
  loadModelPolicy,
  resolveModelCandidates,
  type AITask,
  type AIModelTier,
} from "./model-policy";

const validEnv = {
  AI_MODEL_FAST: "google/fast",
  AI_MODEL_FAST_FALLBACK: "openai/fast-backup",
  AI_MODEL_QUALITY: "anthropic/quality",
  AI_MODEL_QUALITY_FALLBACK: "openai/quality-backup",
  AI_APPROVED_MODELS:
    "google/fast,openai/fast-backup,anthropic/quality,openai/quality-backup",
};

const expectedTiers: Record<AITask, AIModelTier> = {
  "resume.parse": "fast",
  "question.generate": "fast",
  "question.follow-up": "fast",
  "answer.score": "quality",
  "report.generate": "quality",
  "coach.generate": "quality",
  "coach.evaluate": "quality",
};

test("maps every task to its fixed first-phase tier", () => {
  for (const [task, tier] of Object.entries(expectedTiers)) {
    assert.equal(getTaskTier(task as AITask), tier);
  }
});

test("builds fast candidates in escalation order", () => {
  const policy = loadModelPolicy(validEnv);
  assert.deepEqual(resolveModelCandidates("resume.parse", policy), {
    tier: "fast",
    models: [
      "google/fast",
      "openai/fast-backup",
      "anthropic/quality",
      "openai/quality-backup",
    ],
  });
});

test("quality candidates never contain fast models", () => {
  const policy = loadModelPolicy(validEnv);
  assert.deepEqual(resolveModelCandidates("answer.score", policy), {
    tier: "quality",
    models: ["anthropic/quality", "openai/quality-backup"],
  });
});

test("requires both primary tiers", () => {
  assert.throws(() => loadModelPolicy({}), /AI_MODEL_FAST/);
  assert.throws(
    () => loadModelPolicy({ AI_MODEL_FAST: "google/fast" }),
    /AI_MODEL_QUALITY/,
  );
});

test("rejects malformed creator/model identifiers", () => {
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_FAST: "fast" }),
    /creator\/model/,
  );
});

test("validates optional and quality model identifiers", () => {
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_FAST_FALLBACK: "invalid" }),
    /creator\/model/,
  );
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_QUALITY: "invalid" }),
    /creator\/model/,
  );
});

test("rejects duplicate configured models", () => {
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_FAST_FALLBACK: "google/fast",
      }),
    /duplicate/i,
  );
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_QUALITY: "google/fast" }),
    /duplicate/i,
  );
});

test("rejects configured models outside the approved registry", () => {
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_FAST: "google/unapproved",
      }),
    /approved/i,
  );
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_QUALITY_FALLBACK: "openai/unapproved-quality",
      }),
    /approved/i,
  );
});

test("requires a non-empty approved-model registry", () => {
  const { AI_APPROVED_MODELS: _missing, ...withoutRegistry } = validEnv;
  assert.throws(() => loadModelPolicy(withoutRegistry), /AI_APPROVED_MODELS/);
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_APPROVED_MODELS: " " }),
    /AI_APPROVED_MODELS/,
  );
});

test("trims optional fallback values", () => {
  const policy = loadModelPolicy({
    AI_MODEL_FAST: " google/fast ",
    AI_MODEL_QUALITY: " anthropic/quality ",
    AI_MODEL_FAST_FALLBACK: " ",
    AI_APPROVED_MODELS: "google/fast,anthropic/quality",
  });
  assert.deepEqual(resolveModelCandidates("question.generate", policy), {
    tier: "fast",
    models: ["google/fast", "anthropic/quality"],
  });
});

```

- [ ] **Step 3: Run the test and verify it fails**

Run `pnpm test`.

Expected: the test file is discovered and FAILS because `model-policy.ts` does not exist; the TAP summary must not say `tests 0`.

- [ ] **Step 4: Implement the policy module**

Create `lib/ai/model-policy.ts` containing:

- The seven `AITask` literals and `AIModelTier = "fast" | "quality"`.
- A complete `Record<AITask, AIModelTier>` matching the test.
- `loadModelPolicy(env = process.env)`, which trims values, requires both primary models, validates `creator/model`, rejects duplicates, and returns a flat `Readonly<ModelPolicy>`. Runtime freezing is not required because every field is an immutable string or `undefined`.
- A required comma-separated `AI_APPROVED_MODELS` registry. Every configured primary and fallback must appear in the registry; this is the deployment-time enforcement point for models that passed capability and scoring-consistency review.
- `resolveModelCandidates(task, policy)`, which returns fast candidates as fast primary, optional fast fallback, quality primary, optional quality fallback; quality candidates contain only quality primary and optional quality fallback.

Use this identifier validation:

```ts
const MODEL_ID_PATTERN = /^[^/\s]+\/[^/\s]+$/;
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm test
npx tsc --noEmit
```

Expected: exactly 10 tests pass, 0 fail, and TypeScript exits 0.

- [ ] **Step 6: Commit the routing foundation**

```bash
git add package.json lib/ai/model-policy.ts lib/ai/model-policy.test.ts
git commit -m "feat(ai): define validated task model policy"
```

## Chunk 2: Bounded Structured Generation

### Task 2: Implement provider-independent retry, repair, and fallback flow

**Files:**
- Create: `lib/ai/model-fallback.ts`
- Create: `lib/ai/model-fallback.test.ts`

- [ ] **Step 1: Write failing executor tests**

Use symbolic errors and an injected classifier. Cover exactly nine cases: immediate success; one global repair; failed repair advancing to the next model without a second repair budget; one transient same-model retry; second transient failure advancing; immediate fallback; fatal stop; abort during backoff; and final eligible error after candidate exhaustion.

The fake attempt records every `{ model, repair }`. Inject `sleep` and `random`; with `random = () => 0`, assert that the transient retry sleeps exactly 250 ms.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `pnpm test`.

Expected: the 10 Chunk 1 tests pass and the new executor tests fail because `model-fallback.ts` does not exist.

- [ ] **Step 3: Implement `runModelCandidates`**

```ts
export type ModelErrorAction =
  | "repair"
  | "transient"
  | "fallback"
  | "fatal";

export async function runModelCandidates<T>(options: {
  models: readonly string[];
  signal: AbortSignal;
  classifyError: (error: unknown) => ModelErrorAction;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  attempt: (input: {
    model: string;
    repair: boolean;
    previousError?: unknown;
    signal: AbortSignal;
  }) => Promise<T>;
}): Promise<T>;
```

Allow one repair across the whole invocation and one transient retry per model. Pass the repair-triggering error back as `previousError` only on the repair call so the adapter can include bounded invalid output. Use `250 + Math.floor(random() * 250)` milliseconds for the transient retry. Abort cancels every remaining action. Fatal errors throw immediately; exhaustion throws the final eligible error.

- [ ] **Step 4: Verify and commit the executor**

Run `pnpm test` and expect exactly 19 tests to pass, 0 fail. Then commit:

```bash
git add lib/ai/model-fallback.ts lib/ai/model-fallback.test.ts
git commit -m "feat(ai): add bounded model fallback executor"
```

### Task 3: Add Gateway-aware error classification

**Files:**
- Create: `lib/ai/model-errors.ts`
- Modify: `lib/ai/model-fallback.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the direct Gateway dependency**

Run `pnpm add @ai-sdk/gateway`; error guards imported by application code must be a direct dependency.

- [ ] **Step 2: Write twelve failing classifier tests**

Test: AI SDK no-object/no-output errors as `repair`; `NoObjectGeneratedError` with `finishReason: "content-filter"` as `fatal`; Zod errors as `repair`; Gateway rate-limit/internal errors as `transient`; Gateway response errors only for 408/429/5xx as `transient` and a 401 response as `fatal`; Gateway model-not-found as `fallback`; Gateway auth/invalid-request as `fatal`; `APICallError` only for 408/429/5xx as `transient`, including an explicit 409 fatal case; other 4xx as `fatal`; `RetryError.lastError` recursive unwrapping; identified Undici/network-cause `TypeError` as `transient`; and an ordinary programming `TypeError` plus unknown errors as `fatal`.

Construct exported errors with documented constructors and guards. Do not match arbitrary message strings.

- [ ] **Step 3: Implement the env-free classifier**

Create `model-errors.ts` exporting `classifyModelError(error)`. It must not import model policy or read environment variables. Unwrap `RetryError.lastError` recursively before applying AI SDK and Gateway guards. Check content filtering before generic structured-output repair. Use an explicit 408/429/5xx status allowlist. The network guard must require a `TypeError` whose `cause.code` is one of the documented Undici/common network codes (`UND_ERR_*`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, or `ECONNREFUSED`); an ordinary `TypeError` is fatal.

- [ ] **Step 4: Verify and commit classification**

Run `pnpm test` and expect exactly 31 tests to pass, 0 fail. Then commit:

```bash
git add package.json pnpm-lock.yaml lib/ai/model-errors.ts lib/ai/model-fallback.test.ts
git commit -m "feat(ai): classify gateway model failures"
```

### Task 4: Adapt AI SDK structured and streaming calls

**Files:**
- Create: `lib/ai/generate-structured.ts`
- Create: `lib/ai/generate-structured.test.ts`

- [ ] **Step 1: Write eight failing injected-adapter tests**

Use factory-created adapters with fake call functions. Assert fast and quality candidate order; `maxRetries: 0`; global repair instruction plus 4,000-character invalid-output truncation; mandatory final `schema.parse`; combined external/internal abort; a 5 ms injectable timeout; streaming primary plus `providerOptions.gateway.models`; and preservation of streaming schema/signal without application replay. The repair test must include delimiter-breaking and instruction-like invalid text, assert that it never appears in the system message, and assert that the user prompt contains only a clearly labeled `JSON.stringify` encoding of the truncated untrusted output.

- [ ] **Step 2: Run tests and verify the adapter import fails**

Run `pnpm test`.

Expected: 31 earlier tests pass and the adapter test file fails because `generate-structured.ts` does not exist.

- [ ] **Step 3: Implement injectable adapters and production exports**

Create `createStructuredGenerator({ policy, invoke, timeoutMs = 45_000, sleep, random })`. The small local `invoke` interface returns unknown output; the factory validates it with the supplied Zod schema. Combine the caller signal with `AbortSignal.timeout(timeoutMs)`, execute through `runModelCandidates`, set AI SDK `maxRetries: 0`, use `classifyModelError`, and return only `schema.parse(output)`.

The single repair reads `previousError` supplied by the executor and appends only the trusted strict-JSON correction to the system message. Put at most 4,000 characters from `NoObjectGeneratedError.text` into the user prompt as clearly labeled untrusted data encoded with `JSON.stringify`; never promote prior model output into the system role. Export a production `generateStructured` using AI SDK `generateText` and `Output.object`.

Keep module import env-free for unit tests: production exports obtain policy through a memoized `getProductionPolicy()` that calls `loadModelPolicy(process.env)` on first invocation. Final startup enforcement is added through `instrumentation.ts` in Chunk 4.

Use this public boundary:

```ts
export async function generateStructured<TSchema extends z.ZodType>(input: {
  task: AITask;
  schema: TSchema;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<z.output<TSchema>>;
```

- [ ] **Step 4: Implement the streaming adapter boundary**

Export `streamStructured` with the same generic input and the inferred AI SDK `StreamTextResult` return. Use the first candidate as `model`, remaining candidates as `providerOptions.gateway.models`, the combined deadline signal, `maxRetries: 0`, and `Output.object`. Gateway may fail over before a usable stream; local failure after partial delivery is surfaced and never replayed.

- [ ] **Step 5: Verify and commit adapters**

Run `pnpm test` and expect exactly 39 tests to pass, 0 fail. Run `npx tsc --noEmit` and expect exit 0. Then commit:

```bash
git add lib/ai/generate-structured.ts lib/ai/generate-structured.test.ts
git commit -m "feat(ai): add bounded structured generation"
```

## Chunk 3: Business Call Migration

### Task 5: Add task-usage contract tests

**Files:**
- Create: `lib/ai/task-usage.test.ts`

- [ ] **Step 1: Write source-contract tests before migration**

Read `lib/resume/parse-resume.ts` and `lib/interview/index.ts` with `node:fs/promises`. Slice each exported function from its declaration to the next exported function and assert these exact helper/task/schema tuples:

```text
parseResumeWithAI            -> generateStructured / resume.parse / parsedResumeSchema
generateInterviewQuestions   -> generateStructured / question.generate / generatedQuestionsSchema
scoreInterviewAnswer         -> generateStructured / answer.score / scoreResultSchema
generateInterviewReport      -> generateStructured / report.generate / interviewReportSchema
generateFollowUp             -> generateStructured / question.follow-up / followUpRoundSchema
generateCoachContent         -> generateStructured / coach.generate / coachStartSchema
evaluateCoachAnswer          -> generateStructured / coach.evaluate / coachEvaluateSchema
```

Also assert that the two source files contain none of `chatLanguageModel`, `@ai-sdk/openai`, or direct `generateText({` calls after migration. Streaming assertions are added separately in Task 7.

- [ ] **Step 2: Run tests and verify the usage contract fails**

Run `pnpm test`.

Expected: policy and fallback tests pass; task-usage tests FAIL against the current direct provider calls.

- [ ] **Step 3: Keep the red test uncommitted for the migration task**

Do not commit a deliberately failing repository state. Proceed directly to Task 6, which makes these contract tests green and commits tests with implementation.

### Task 6: Migrate non-streaming business services

**Files:**
- Modify: `lib/resume/parse-resume.ts:1-29`
- Modify: `lib/interview/index.ts:1-225`
- Modify: `lib/ai/task-usage.test.ts`

- [ ] **Step 1: Migrate resume parsing**

Replace direct AI SDK/provider imports with `generateStructured`. Preserve the existing system and user prompt text verbatim and call task `resume.parse` with `parsedResumeSchema`.

- [ ] **Step 2: Migrate all interview functions**

Replace each direct `generateText`/`Output.object` block with `generateStructured`, using the six interview mappings enforced by `task-usage.test.ts`. Preserve every existing system prompt, user prompt, Zod schema, public function signature, and returned shape. Extract a system prompt to a named constant only when needed; do not refer to an undefined placeholder such as `existingSystemPrompt`.

- [ ] **Step 3: Run focused and static verification**

Run:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
test -z "$(rg 'chatLanguageModel|@ai-sdk/openai|generateText\(|Output\.object' lib/resume lib/interview || true)"
```

Expected: all tests pass, static commands exit 0, and the final shell assertion produces no output.

- [ ] **Step 4: Commit the service migration**

```bash
git add lib/resume/parse-resume.ts lib/interview/index.ts lib/ai/task-usage.test.ts
git commit -m "refactor(ai): route interview tasks by tier"
```

### Task 7: Migrate streamed next-question generation

**Files:**
- Modify: `app/api/interviews/[id]/next-question/route.ts:1-13`
- Modify: `app/api/interviews/[id]/next-question/route.ts:261-269`
- Modify: `lib/ai/task-usage.test.ts`

- [ ] **Step 1: Add a failing stream-route contract test**

Extend `task-usage.test.ts` to read the `POST` function in `app/api/interviews/[id]/next-question/route.ts` and assert that it contains all of:

```text
streamStructured
task: "question.generate"
schema: generatedQuestionSchema
abortSignal: request.signal
```

Also assert that the route contains none of `chatLanguageModel`, direct `streamText({`, or `Output.object`. Run `pnpm test` and expect only the new stream-route contract to fail.

- [ ] **Step 2: Replace the direct stream call**

Import `streamStructured`, remove `streamText`, `Output`, and `chatLanguageModel`, and call task `question.generate` with `generatedQuestionSchema`, `request.signal`, and the exact existing strict-JSON system prompt. Do not change the NDJSON protocol, partial-output loop, custom error mapping, existing-question shortcut, or database insertion.

- [ ] **Step 3: Verify the stream contract and build**

Run:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
AI_MODEL_FAST=google/fast AI_MODEL_QUALITY=anthropic/quality AI_APPROVED_MODELS=google/fast,anthropic/quality AI_GATEWAY_API_KEY=test pnpm build
test -z "$(rg 'chatLanguageModel|streamText\(|Output\.object' 'app/api/interviews/[id]/next-question/route.ts' || true)"
```

Expected: task-usage tests prove `streamStructured`, `question.generate`, `generatedQuestionSchema`, and abort-signal usage; all commands exit 0 and the final assertion has no output.

- [ ] **Step 4: Commit the stream migration**

```bash
git add 'app/api/interviews/[id]/next-question/route.ts' lib/ai/task-usage.test.ts
git commit -m "refactor(ai): route streamed questions through gateway"
```

## Chunk 4: Configuration and Release Verification

### Task 8: Remove provider-specific configuration and document Gateway setup

**Files:**
- Delete: `lib/ai/chat-provider.ts`
- Create: `instrumentation.ts`
- Modify: `lib/ai/model-policy.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example:4-7`
- Modify: `README.md:77-89`

- [ ] **Step 1: Remove the direct OpenAI provider dependency**

Run `pnpm remove @ai-sdk/openai`, delete `lib/ai/chat-provider.ts`, and verify no consumer remains.

- [ ] **Step 2: Add and test Node.js startup validation**

Create root `instrumentation.ts` exporting `register(env: NodeJS.ProcessEnv = process.env)`. When `env.NEXT_RUNTIME` is absent or `nodejs`, require a non-empty `AI_GATEWAY_API_KEY` and call `loadModelPolicy(env)`; when it is `edge`, return without validation because the AI routes use Node.js.

Add four tests: valid Node configuration with a Gateway key succeeds, missing Gateway key throws, invalid Node model configuration throws, and invalid Edge configuration is skipped. Run `pnpm test` and require all tests to pass before continuing.

- [ ] **Step 3: Replace the example AI environment block**

Use exactly:

```env
# Vercel AI Gateway
AI_GATEWAY_API_KEY=your-ai-gateway-key
AI_MODEL_FAST=creator/small-model
AI_MODEL_FAST_FALLBACK=creator/backup-small-model
AI_MODEL_QUALITY=creator/large-model
AI_MODEL_QUALITY_FALLBACK=creator/backup-large-model
AI_APPROVED_MODELS=creator/small-model,creator/backup-small-model,creator/large-model,creator/backup-large-model
```

- [ ] **Step 4: Replace README configuration guidance**

List `AI_GATEWAY_API_KEY`, `AI_MODEL_FAST`, `AI_MODEL_FAST_FALLBACK`, `AI_MODEL_QUALITY`, `AI_MODEL_QUALITY_FALLBACK`, and `AI_APPROVED_MODELS`. Explain that the approved registry contains only models that passed structured-output and scoring-consistency review, explain `creator/model`, fast-to-quality escalation, and the prohibition on quality-to-fast downgrade. Link the model catalog at `https://vercel.com/ai-gateway/models`.

Remove all setup guidance for `OPENAI_API_KEY`, `BASE_URL`, and `BASE_MODEL`.

- [ ] **Step 5: Verify documentation and dependency cleanup**

Run:

```bash
test -z "$(rg 'OPENAI_API_KEY|BASE_URL|BASE_MODEL|@ai-sdk/openai|chatLanguageModel' --glob '!node_modules/**' --glob '!docs/plans/**' --glob '!docs/superpowers/**' . || true)"
pnpm install --frozen-lockfile
pnpm test
npx tsc --noEmit
pnpm lint
AI_MODEL_FAST=google/fast AI_MODEL_QUALITY=anthropic/quality AI_APPROVED_MODELS=google/fast,anthropic/quality AI_GATEWAY_API_KEY=test pnpm build
git diff --check
```

Expected: the stale-configuration assertion prints nothing and every command exits 0.

- [ ] **Step 6: Commit configuration and documentation**

```bash
git add package.json pnpm-lock.yaml .env.example README.md lib/ai/chat-provider.ts instrumentation.ts lib/ai/model-policy.test.ts
git commit -m "docs(ai): configure tiered gateway models"
```

### Task 9: Run production-safe contract smoke tests

**Files:**
- Review: all files changed in Tasks 1-8

- [ ] **Step 1: Configure synthetic-test models**

Set valid Gateway credentials, four distinct supported `creator/model` identifiers, and an `AI_APPROVED_MODELS` registry containing all four. Confirm the application boots; missing Gateway credentials and missing, malformed, duplicate, or unapproved model configuration must fail through `instrumentation.ts` before an AI request is accepted.

- [ ] **Step 2: Exercise all seven task contracts with synthetic data**

Verify valid Zod output for resume parsing, question generation, follow-up, answer scoring, report generation, coach generation, and coach evaluation. Use no real resume or candidate answer.

For every call, capture the Gateway request ID and confirm in Gateway observability that the requested primary model matches the task tier.

- [ ] **Step 3: Verify fallback and non-fallback behavior**

- In a fresh Node process, configure a syntactically valid but unavailable fast primary and confirm Gateway/application logs show the fast fallback served `resume.parse`.
- Run `pnpm exec tsx --test lib/ai/generate-structured.test.ts` and confirm the injected malformed-output case records exactly one global repair before the next candidate.
- In another fresh Node process, use invalid Gateway authentication and confirm it fails immediately without trying another model.
- Run the injected external-abort case and confirm no additional model attempt starts.

Stop the process, restore valid configuration, and start a fresh Node process after every configuration case. The memoized production policy and one-time startup validation must never be reused across smoke-test configurations.

- [ ] **Step 4: Verify final invariants**

Confirm:

- All seven tasks have exactly one fixed tier.
- Gateway credentials and both required primary models validate during Node startup.
- Non-streaming schema failure gets at most one repair before fallback.
- 408, 429, 5xx, and structured-output errors may fall back; other 4xx errors do not.
- The total deadline is 45 seconds across repair and candidate attempts.
- Streaming uses Gateway fallback only before a usable stream is established and never replays after partial delivery.
- Fast candidates may reach quality; quality candidates never include fast.
- Existing prompts, schemas, scoring dimensions, and interview flow remain unchanged.

- [ ] **Step 5: Run the final automated suite**

Run:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
git diff --check
git status --short
```

Expected: tests, typecheck, lint, and build pass; `git diff --check` exits 0; the worktree contains only intentional smoke-test evidence or is clean.

- [ ] **Step 6: Record deferred work in the implementation handoff**

List model snapshots, lifecycle/idempotency, deterministic report aggregation, AI call auditing, and golden-dataset automation as separate follow-ups. Do not create extra files or expand this routing implementation.
