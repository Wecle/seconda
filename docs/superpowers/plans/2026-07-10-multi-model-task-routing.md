# Direct-Provider Multi-Model Task Routing Implementation Plan

> **For agentic workers:** Execute this plan in an isolated branch and stop if unrelated work overlaps a target file. Run the stated verification after each chunk. Do not change the PRD scoring model, business prompts, database schema, or interview state machine.

**Goal:** Replace Vercel AI Gateway with direct DeepSeek, OpenAI, and 智谱 AI 中国区 calls while preserving fixed fast/quality routing, bounded structured generation, and safe fallback behavior.

**Architecture:** `model-policy` resolves ordered candidates together with their credential tier. A Provider Registry maps each provider prefix to an AI SDK Language Model. `generateStructured` owns deadline, repair, and non-stream fallback. `streamStructured` may switch candidates only before it emits the first usable partial result.

**Tech Stack:** TypeScript, Next.js Route Handlers, the latest mutually compatible stable AI SDK/provider package family available at implementation time, Zod, and the existing Node test runner through `tsx`.

**Design reference:** `docs/plans/2026-07-10-multi-model-routing-design.md`

## Scope

This plan preserves the seven fixed tasks and existing fast/quality policy. It adds direct provider construction for `deepseek/*`, `openai/*`, and `zhipu/*`, replaces Gateway-only configuration, and retains first-usable-partial stream fallback.

Out of scope: seven independent per-task models, cross-provider fallback inside the same tier, LiteLLM deployment, consumer-subscription credentials, model snapshots, lifecycle/idempotency, report aggregation, persistent AI auditing, and golden-dataset automation.

## Configuration Contract

```env
FAST_MODEL_API_KEY=fast-tier-provider-api-key
QUALITY_MODEL_API_KEY=quality-tier-provider-api-key
AI_MODEL_FAST=deepseek/deepseek-chat
AI_MODEL_QUALITY=zhipu/glm-5.1
AI_MODEL_QUALITY_FALLBACK=zhipu/glm-4.7
AI_APPROVED_MODELS=deepseek/deepseek-chat,zhipu/glm-5.1,zhipu/glm-4.7
```

These model IDs demonstrate the configuration shape; confirm current China-region model IDs before deployment. Fast primary/fallback must share a provider prefix, as must quality primary/fallback. Fast candidates use `FAST_MODEL_API_KEY`; quality candidates use `QUALITY_MODEL_API_KEY`. Fast may escalate to quality, which then uses the quality Key.

## File Map

- Create `lib/ai/provider-registry.ts` and `lib/ai/provider-registry.test.ts`.
- Create a provider-neutral AI error sanitizer and tests under `lib/ai/`.
- Modify `lib/ai/model-policy.ts` and tests to retain candidate credential tiers and validate same-tier provider prefixes.
- Modify `lib/ai/model-errors.ts` and tests to remove Gateway-only guards and classify direct-provider failures.
- Modify `lib/ai/generate-structured.ts` and tests to use the registry and direct streaming fallback.
- Modify `app/api/interviews/[id]/next-question/route.ts` and `lib/ai/task-usage.test.ts` to define first usable output and reject empty final questions.
- Modify all AI Route Handlers that log provider errors to use the sanitizer.
- Modify `instrumentation.ts` and `lib/ai/instrumentation.test.ts` for layer-key startup validation.
- Modify `.env.example`, `README.md`, `package.json`, `pnpm-lock.yaml`, and related provider-neutral i18n copy.
- Delete Gateway-specific configuration and dependency use after production adapters have migrated.

## Chunk 0: Workspace Guard

### Task 0: Inspect and protect the current worktree

- [ ] Read `AGENTS.md`, the full PRD, the design document, and this implementation plan before changing code.
- [ ] Run `git status --short`, `git diff`, and `git diff --cached`; record pre-existing changes.
- [ ] Do not edit, stage, revert, format, or commit unrelated files. If a target file already contains unrelated edits, preserve them and stop for user direction only if the changes cannot be safely separated.
- [ ] Create or switch to the implementation branch without resetting the worktree.

## Chunk 1: Compatible Dependencies, Policy, and Registry

### Task 1: Resolve the latest suitable AI SDK dependency family

- [ ] Inspect current `package.json`, lockfile, Node/Next constraints, and the latest stable releases and peer dependency ranges for `ai`, the existing Gateway package, `@ai-sdk/openai`, and `@ai-sdk/openai-compatible`.
- [ ] Select the newest mutually compatible stable combination suitable for the repository. Do not copy fixed major/minor versions from this plan. If any package's `latest` tag is incompatible, use the newest compatible stable release and record the constraint in the handoff.
- [ ] Update the AI SDK core and provider dependencies as one coordinated change before importing new providers in production code. Keep Gateway temporarily only if existing code needs it to remain green during migration.
- [ ] Do not use `--save-exact`; preserve the repository's normal semver range style in `package.json`, let `pnpm-lock.yaml` record the reproducible resolved versions, and report those versions at completion.
- [ ] Add a minimal provider type/protocol smoke test and run `pnpm install --frozen-lockfile`, `pnpm test`, and `npx tsc --noEmit`.

### Task 2: Extend resolved candidates with credential tier

- [ ] Add failing tests proving fast candidates are returned as `{ model, credentialTier: "fast" }` followed by quality-tier candidates, while quality tasks include only quality-tier candidates.
- [ ] Add prefix parsing for `deepseek`, `openai`, and `zhipu`; reject unknown prefixes.
- [ ] Validate that configured fast primary/fallback use the same prefix, and likewise for quality primary/fallback.
- [ ] Preserve required primary models, approved registry, trimming, and duplicate model ID validation.
- [ ] Update every existing test fixture that uses old/unknown prefixes in the same change so the full suite remains coherent.
- [ ] Run `pnpm test` and `npx tsc --noEmit`.

### Task 3: Create the direct Provider Registry

- [ ] Add a small registry that accepts `{ model, credentialTier, apiKey }` and returns an AI SDK Language Model plus only the adapter metadata needed for safe logs/tests.
- [ ] Split `provider/model` before construction; pass only the vendor model ID to the provider.
- [ ] Construct `deepseek/*` through `createOpenAICompatible` with `https://api.deepseek.com` and verify the final URL is `https://api.deepseek.com/chat/completions`.
- [ ] Construct `openai/*` through `createOpenAI({ apiKey: selectedTierKey })`; never use the default singleton or ambient `OPENAI_API_KEY`.
- [ ] Construct `zhipu/*` through `createOpenAICompatible` with `https://open.bigmodel.cn/api/paas/v4/` and verify the final URL is `https://open.bigmodel.cn/api/paas/v4/chat/completions`.
- [ ] Configure provider capabilities explicitly: DeepSeek JSON Object mode unless JSON Schema is proven, adapter-level JSON instruction, fast-tier thinking disabled, and an explicit quality thinking policy. Do not pass unsupported options.
- [ ] Add injected fetch tests for prefix, stripped model ID, endpoint, selected tier Key, structured-output body, thinking body, and unknown-provider rejection. Poison or omit `OPENAI_API_KEY` in the OpenAI test.
- [ ] Run `pnpm test` and `npx tsc --noEmit`.
- [ ] Commit: `feat(ai): add direct provider registry`.

## Chunk 2: Direct Retry, Repair, and Streaming

### Task 4: Update direct-provider error classification

- [ ] Remove Gateway-specific error guards and tests.
- [ ] Retain typed AI SDK structured-output, Zod, `RetryError`, `APICallError`, and documented network-cause handling.
- [ ] Classify 408/429/5xx as transient; then classify statusless `APICallError` with `isRetryable: true` as transient; classify other known 4xx as fatal.
- [ ] Keep content-safety refusal and unknown programming errors fatal. Do not infer model availability through fragile message matching.
- [ ] Add table-driven tests covering statusless wrapped fetch failures, known status codes, nested causes, and fatal authentication/parameter failures.
- [ ] Run `pnpm test`; commit `refactor(ai): classify direct provider failures`.

### Task 5: Replace Gateway non-stream adapters

- [ ] Replace `gateway(model)` with the Provider Registry in `generateStructured`.
- [ ] Pass the candidate credential-tier Key explicitly; keep `maxRetries: 0`, one 45-second combined deadline, one global repair, and final `schema.parse`.
- [ ] Delete Gateway-specific provider options from this path.
- [ ] Keep injected tests for candidate order, tier-Key switch, repair prompt safety, deadline, validation, and external abort.
- [ ] Run `pnpm test` and `npx tsc --noEmit`.

### Task 6: Implement pre-output-only streaming fallback

- [ ] Define a minimal `StructuredStreamResult<T>` containing only `{ partialOutputStream, output }`; do not cast the wrapper to the full AI SDK stream result type.
- [ ] Add failing tests for: error before usable partial → next candidate; usable partial then error → no next candidate; valid final object without partial → commit; invalid final object before commit → repair/fallback; external abort → no fallback.
- [ ] Add `isUsablePartial` plus a `validateFinal` callback. Set committed before yielding the first usable partial, and run both Zod and `validateFinal` before committing a final object that produced no usable partial. Before commitment, apply the same global repair and transient retry budgets as non-streaming generation.
- [ ] Capture provider failures through `streamText.onError`; when AI SDK turns them into stream error parts, prefer the captured raw `APICallError` over a later `NoOutputGeneratedError` for classification.
- [ ] Give every candidate attempt its own `AbortController`, combined with caller abort and the one global 45-second deadline. Abort/cancel an old attempt before retry or fallback so it cannot continue generating or billing.
- [ ] Ensure only the committed candidate owns the final output promise. After commitment, surface every error without fallback or replay.
- [ ] Use real AI SDK stream error-event fixtures in addition to fake iterator throws.
- [ ] Run `pnpm test` and `npx tsc --noEmit`; commit `feat(ai): add safe direct streaming fallback`.

## Chunk 3: Startup, Route, and Privacy Migration

### Task 7: Replace Gateway startup validation before build verification

- [ ] Require both `FAST_MODEL_API_KEY` and `QUALITY_MODEL_API_KEY`, because both primary tiers are mandatory.
- [ ] Keep Node-only validation, Edge-runtime bypass, and all model-policy checks.
- [ ] Add tests for valid two-key configuration, each missing Key, invalid same-tier provider pairing, duplicate models, unknown prefixes, and Edge bypass.
- [ ] Remove startup assumptions about `AI_GATEWAY_API_KEY`.
- [ ] Run `pnpm test` and `npx tsc --noEmit`; commit `refactor(ai): validate direct model credentials`.

### Task 8: Preserve the streamed next-question route safely

- [ ] Add pure helper tests for usable partial detection: whitespace-only, duplicate output, and the first new non-whitespace `question`, `topic`, or `tip` delta.
- [ ] Extend the route source contract test to require `streamStructured`, `question.generate`, `generatedQuestionSchema`, `request.signal`, and the usable-partial helper.
- [ ] Preserve the NDJSON protocol, existing-question shortcut, partial loop, final schema validation, and database insertion.
- [ ] Add a pure final semantic validator requiring `question.trim()` to be non-empty and pass it to `streamStructured` as `validateFinal`. A no-partial invalid final object must repair/fallback before commitment and must never reach database insertion.
- [ ] Test both semantic-failure boundaries: no partial + empty question repairs/falls back; a previously emitted usable `topic`/`tip` + empty final question reports an error without fallback or database insertion.
- [ ] Verify committed-before-write ordering and that any other post-commit failure does not start another provider or insert an incomplete question.
- [ ] Run `pnpm test`, `npx tsc --noEmit`, and `pnpm lint`.
- [ ] Commit: `refactor(ai): preserve streamed direct-provider fallback`.

### Task 9: Sanitize AI provider errors across logs, responses, and persistence

- [ ] Create one provider-neutral sanitizer that emits a safe error category, status, provider/model, retryability, and provider request ID where available.
- [ ] Trace every `generateStructured`/`streamStructured` caller, including background jobs and resume parsing. Replace raw provider-object logging and any use of raw `error.message` in API responses or persisted error/status fields with the same safe summary.
- [ ] Never log, return, or persist request bodies, response bodies, prompts, resume contents, answers, authorization headers, API Keys, or unclassified provider messages.
- [ ] Add sentinel tests containing fake PII and fake Keys in nested `APICallError` fields and causes; assert none appears in serialized logs, HTTP response bodies, or captured persistence writes.
- [ ] Run `pnpm test`, `npx tsc --noEmit`, and `pnpm lint`.
- [ ] Commit: `fix(ai): sanitize provider errors`.

## Chunk 4: Cleanup, Deterministic Contracts, and Release Verification

### Task 10: Remove Gateway configuration and finish documentation

- [ ] Remove `@ai-sdk/gateway` only after all production call sites have migrated; let pnpm update the lockfile.
- [ ] Replace Gateway environment examples and README guidance with the two layer-Key contract and supported prefixes.
- [ ] Document 智谱 AI 中国区 endpoint and clarify that model examples must be confirmed against the current China-region model list.
- [ ] Update user-facing authentication/model-unavailable hints to be provider-neutral.
- [ ] Confirm no source references remain to `AI_GATEWAY_API_KEY`, `@ai-sdk/gateway`, `gateway(`, `providerOptions.gateway`, `zai/*`, or `api.z.ai`.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm test`, `npx tsc --noEmit`, `pnpm lint`, and `git diff --check`.
- [ ] Commit: `docs(ai): configure direct tiered providers`.

### Task 11: Add deterministic provider contracts and opt-in live smoke tests

- [ ] Build injected fetch/local SSE fixtures for successful JSON, pre-output 429/5xx, statusless network failure, AI SDK error part, post-output failure, timeout, and caller abort. Normal tests must never call real providers or incur fees.
- [ ] Target every configured candidate, not merely each task once. Each quality candidate must also pass the fast-task Schemas because fast fallback may escalate to quality.
- [ ] Verify request bodies for endpoint, stripped model ID, tier Key, JSON mode/schema capability, thinking option, and absence of ambient `OPENAI_API_KEY` usage.
- [ ] Add a separate opt-in command such as `pnpm test:ai:contract` that requires explicit non-production provider Keys and synthetic interview data.
- [ ] In the opt-in run, exercise successful output for all seven tasks and every applicable candidate; confirm outputs pass local Zod validation. Do not depend on inducing live 429/5xx or stream timing failures.
- [ ] Confirm invalid credentials fail immediately and sanitized logs contain no Key or synthetic PII.

## Final Verification

Run the exact commands required by the repository and record exit codes. The build command must supply syntactically valid, non-secret placeholder model configuration because startup validation runs during build; it must not make provider requests.

```bash
pnpm install --frozen-lockfile
pnpm test
npx tsc --noEmit
pnpm lint
FAST_MODEL_API_KEY=test-fast \
QUALITY_MODEL_API_KEY=test-quality \
AI_MODEL_FAST=deepseek/deepseek-chat \
AI_MODEL_QUALITY=zhipu/glm-5.1 \
AI_MODEL_QUALITY_FALLBACK=zhipu/glm-4.7 \
AI_APPROVED_MODELS=deepseek/deepseek-chat,zhipu/glm-5.1,zhipu/glm-4.7 \
pnpm build
git diff --check
git status --short
```

Also report:

- the resolved AI SDK/provider package versions and why any package is not on its `latest` tag;
- unit/typecheck/lint/build results;
- deterministic contract-test results;
- whether the optional paid live contract command was run, skipped, or failed for missing credentials;
- pre-existing unrelated worktree changes left untouched.

## Rollback

If direct-provider schema contracts or stream behavior fail, revert only the direct-provider commit series and redeploy the last Gateway-based release. No database migration is involved. Never reset unrelated worktree changes.
