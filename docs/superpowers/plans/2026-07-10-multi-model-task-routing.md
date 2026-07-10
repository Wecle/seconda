# Direct-Provider Multi-Model Task Routing Implementation Plan

> **For agentic workers:** Execute this plan in an isolated branch. Run the stated verification after each chunk. Do not change the PRD scoring model, prompts, database schema, or interview state machine.

**Goal:** Replace Vercel AI Gateway with direct DeepSeek, OpenAI and Z.AI/GLM Provider Registry calls while preserving fixed fast/quality routing, bounded structured generation and safe fallback behavior.

**Architecture:** `model-policy` resolves ordered candidates together with their credential tier. A Provider Registry maps the candidate's provider prefix to an AI SDK Language Model. `generateStructured` owns deadline, repair and non-stream fallback. `streamStructured` may switch candidates only before it emits the first usable partial result.

**Tech Stack:** TypeScript 5, Next.js 16 Route Handlers, AI SDK 6, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, Zod 4, Node 20 test runner through `tsx`.

**Design reference:** `docs/plans/2026-07-10-multi-model-routing-design.md`

## Scope

This plan preserves the seven fixed tasks and the existing fast/quality policy. It adds direct provider construction for `deepseek/*`, `openai/*` and `zai/*`, replaces Gateway-only configuration, and retains first-usable-partial stream fallback.

Out of scope: seven independent per-task models, cross-provider fallback inside the same tier, LiteLLM deployment, consumer-subscription credentials, model snapshots, lifecycle/idempotency, report aggregation, persistent AI auditing and golden-dataset automation.

## Configuration Contract

```env
FAST_MODEL_API_KEY=fast-tier-provider-api-key
QUALITY_MODEL_API_KEY=quality-tier-provider-api-key
AI_MODEL_FAST=deepseek/deepseek-v4-flash
AI_MODEL_FAST_FALLBACK=deepseek/deepseek-v4-pro
AI_MODEL_QUALITY=zai/glm-5.1
AI_MODEL_QUALITY_FALLBACK=zai/glm-5
AI_APPROVED_MODELS=deepseek/deepseek-v4-flash,deepseek/deepseek-v4-pro,zai/glm-5.1,zai/glm-5
```

`AI_MODEL_FAST` and `AI_MODEL_FAST_FALLBACK`, if present, must use the same provider prefix. The same rule applies to quality. Fast candidates use `FAST_MODEL_API_KEY`; quality candidates use `QUALITY_MODEL_API_KEY`. Fast may escalate to quality, which then uses the quality Key.

## File Map

- Create `lib/ai/provider-registry.ts` and `lib/ai/provider-registry.test.ts`.
- Modify `lib/ai/model-policy.ts` and `lib/ai/model-policy.test.ts` to retain candidate credential tiers and validate same-tier provider prefixes.
- Modify `lib/ai/model-errors.ts` and tests to remove Gateway-only error types and add direct-provider model-unavailable normalization.
- Modify `lib/ai/generate-structured.ts` and tests to use the registry and direct streaming fallback.
- Modify `app/api/interviews/[id]/next-question/route.ts` and `lib/ai/task-usage.test.ts` to define first usable stream output.
- Modify `instrumentation.ts` and `lib/ai/instrumentation.test.ts` for layer-key startup validation.
- Modify `.env.example`, `README.md`, `package.json`, `pnpm-lock.yaml`, and direct-provider-related i18n copy.
- Delete Gateway-specific configuration and dependency use.

## Chunk 1: Model Policy and Provider Registry

### Task 1: Extend resolved candidates with credential tier

- [ ] Add failing tests proving fast candidates are returned as `{ model, credentialTier: "fast" }` followed by quality-tier candidates, while quality tasks include only quality-tier candidates.
- [ ] Add provider-prefix parsing for `deepseek`, `openai` and `zai`; reject unknown prefixes.
- [ ] Validate that configured fast primary/fallback use the same provider prefix, and likewise for quality primary/fallback.
- [ ] Preserve current validation of required primary models, approved registry, trimming and duplicate model IDs.
- [ ] Run `pnpm test` and `npx tsc --noEmit`.

### Task 2: Create the direct Provider Registry

- [ ] Add a small registry that accepts `{ model, credentialTier, apiKey }` and returns an AI SDK Language Model.
- [ ] Split every `provider/model` ID before construction; pass only the vendor model ID to the provider.
- [ ] Construct `deepseek/*` through `createOpenAICompatible` with `https://api.deepseek.com` and verify the resulting request URL is `https://api.deepseek.com/chat/completions`.
- [ ] Construct `openai/*` through the OpenAI provider.
- [ ] Construct `zai/*` through `createOpenAICompatible` with `https://api.z.ai/api/paas/v4/` and verify the resulting request URL is `https://api.z.ai/api/paas/v4/chat/completions`; do not use Z.AI's Coding endpoint for interview tasks.
- [ ] Keep API keys in the registry call path only; never expose them through model policy or return values.
- [ ] Add injected/factory tests for provider prefix, base URL, selected Key and unknown-provider rejection.
- [ ] Commit: `feat(ai): add direct provider registry`.

## Chunk 2: Direct Retry, Repair and Streaming

### Task 3: Update direct-provider error classification

- [ ] Remove `@ai-sdk/gateway` error guards and tests.
- [ ] Retain typed AI SDK structured-output, Zod, RetryError, APICallError and documented network-cause handling.
- [ ] Keep 408/429/5xx as transient and every other 4xx, including direct-provider model-not-found responses, as fatal. Model availability belongs in pre-release contract tests rather than runtime message matching.
- [ ] Verify `pnpm test`; commit `refactor(ai): classify direct provider failures`.

### Task 4: Replace Gateway production adapters

- [ ] Replace `gateway(model)` with the Provider Registry in `generateStructured`.
- [ ] Pass the candidate's credential-tier Key to the registry; keep `maxRetries: 0`, 45-second combined signal, one global repair and final `schema.parse`.
- [ ] Delete Gateway-specific `providerOptions.gateway.models` handling.
- [ ] Keep injected non-stream tests for candidate order, repair prompt safety, deadline, validation and abort.
- [ ] Run `pnpm test` and `npx tsc --noEmit`.

### Task 5: Implement pre-output-only streaming fallback

- [ ] Add failing injected stream tests for: primary error before a usable partial → next candidate; primary usable partial then error → no next candidate; final valid object without partial → commit selected candidate; final invalid object before commit → repair/fallback; external abort → no next candidate.
- [ ] Add `isUsablePartial` to the streaming boundary and define usable as a new, non-whitespace client-visible field compared with the previous emitted partial.
- [ ] Implement a deferred stream result that tries candidates serially until a usable partial is about to be yielded or a final valid object is available. Set committed before yielding the first usable partial. Before commitment, apply the same global repair and transient retry budgets as non-streaming generation.
- [ ] Use one 45-second combined deadline across every pre-commit stream candidate, repair and retry; combine it with caller abort. Only the committed candidate owns the final-result promise. After commitment, surface every error without fallback or replay.
- [ ] Verify `pnpm test`; commit `feat(ai): add safe direct streaming fallback`.

## Chunk 3: Route and Startup Migration

### Task 6: Keep streamed next-question UI with a usable-output boundary

- [ ] Extend the route source contract test to require `streamStructured`, `question.generate`, `generatedQuestionSchema`, `request.signal` and an `isUsablePartial` callback.
- [ ] In the route, define a partial as usable only when `question`, `topic` or `tip` introduces a new non-whitespace value relative to the last emitted partial.
- [ ] Preserve the NDJSON protocol, existing-question shortcut, partial-output loop, final schema validation and database insertion.
- [ ] Verify `pnpm test`, `npx tsc --noEmit`, `pnpm lint` and `pnpm build`.
- [ ] Commit: `refactor(ai): preserve streamed direct-provider fallback`.

### Task 7: Replace Gateway startup validation

- [ ] Require both `FAST_MODEL_API_KEY` and `QUALITY_MODEL_API_KEY`, because both primary tiers are mandatory.
- [ ] Keep Edge-runtime bypass and all model policy validation.
- [ ] Add tests for valid two-key configuration, each missing layer Key, invalid same-tier provider pairing and Edge bypass.
- [ ] Remove all `AI_GATEWAY_API_KEY` assumptions.
- [ ] Commit: `refactor(ai): validate direct model credentials`.

## Chunk 4: Dependencies, Documentation and Release Verification

### Task 8: Replace Gateway dependencies and configuration

- [ ] Run `pnpm remove @ai-sdk/gateway`.
- [ ] Add compatible versions of `@ai-sdk/openai` and `@ai-sdk/openai-compatible`.
- [ ] Replace Gateway environment examples and README guidance with the two layer-Key contract and supported prefixes.
- [ ] Update user-facing authentication/model-unavailable hints to be provider-neutral.
- [ ] Confirm no source references remain to `AI_GATEWAY_API_KEY`, `@ai-sdk/gateway`, `gateway(` or `providerOptions.gateway`.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm test`, `npx tsc --noEmit`, `pnpm lint`, `pnpm build` and `git diff --check`.
- [ ] Commit: `docs(ai): configure direct tiered providers`.

### Task 9: Production-safe contract smoke tests

- [ ] In a non-production environment, configure a valid DeepSeek fast tier and a valid Z.AI or OpenAI quality tier using valid non-production API Keys and synthetic interview data.
- [ ] Exercise resume parsing, question generation, follow-up, answer scoring, report generation, coach generation and coach evaluation; confirm each output passes its Zod schema.
- [ ] Induce a transient fast-provider failure before the first stream chunk and confirm quality fallback serves the next question.
- [ ] Induce an error after a visible stream chunk and confirm no second provider starts.
- [ ] Confirm invalid credentials fail immediately, no Key appears in logs, and `git diff --check` remains clean.
- [ ] Record request IDs from each provider's own dashboard; there is no Gateway observability dependency.

## Final Verification

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
git diff --check
git status --short
```

## Rollback

If direct-provider schema contracts or stream behavior fail, revert the direct-provider commit series and redeploy the last Gateway-based release. No database migration is involved.
