# Agent Context Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cache-friendly, token-budgeted Prompt Pipe with deterministic stable prefixes, JIT resume evidence, low-frequency checkpoints, and three-level context recovery.

**Architecture:** Context is persisted as source data and assembled incrementally for each model call. The Prompt Pipe emits ordered, versioned segments: immutable system rules, stable tool contracts, semi-stable interview/resume context, checkpoint summary, compact coverage, recent transcript tail, and the current instruction. Compaction updates a checkpoint only every 4-6 candidate rounds or under token pressure, creating an explicit cache epoch instead of rewriting the prompt every turn.

**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Vercel AI SDK structured output, deterministic JSON serialization, Node test runner.

## Global Constraints

- No timestamps, random ids, run ids, attempt ids, or volatile counters may appear before stable cacheable segments.
- Object keys and tool ordering are deterministic.
- Ordinary turns append recent messages and do not create a new cache epoch.
- Prompt template changes, target-role correction, tool-contract changes, and compaction create a new cache epoch.
- Keep at least 20% model context headroom and a configurable output reserve.
- Full resume text is never injected every turn; use stable evidence ids and JIT tools.
- Tool call/result pairs cannot be split by pruning or compaction.
- Compaction preserves resume evidence ids, category counts, active follow-up threads, user preferences, active skills, and recent raw messages.
- Compaction retries are bounded and terminate as `prompt_too_long` after three failed recovery levels.

---

### Task 1: Add Context Snapshot and Cache Telemetry Persistence

**Files:** `lib/db/schema.ts`, `lib/db/migrate.ts`, `lib/interview/agent/contracts.ts`, `lib/interview/agent/context-contracts.test.ts`

- [ ] Add failing tests for structured summary, cache epoch, transcript boundary, token estimate, active threads, evidence ids and compaction level.
- [ ] Add `interview_context_snapshots` with unique `(interview_id, cache_epoch)` and indexes.
- [ ] Add run fields `prompt_template_version`, `cache_epoch`, `context_input_tokens`, `compaction_input_tokens`, and `compaction_output_tokens`.
- [ ] Add idempotent migration and run it twice.
- [ ] Run tests/typecheck and commit `feat(interview): persist context checkpoints and cache epochs`.

### Task 2: Implement Deterministic Prompt Pipe and Budgeting

**Files:** `lib/interview/agent/context/prompt-pipe.ts`, `budget.ts`, corresponding tests.

- [ ] Test identical inputs produce byte-identical stable prefixes, volatile ids affect only the tail, tool order is canonical, cache epoch changes only on declared boundaries, and segments are cut by priority under budget.
- [ ] Define segment metadata: `id`, `version`, `priority`, `cacheScope`, `trimPolicy`, `content`, `estimatedTokens`.
- [ ] Serialize stable prefix separately from incremental tail; join without reformatting earlier segments.
- [ ] Estimate tokens conservatively as `ceil(chars/3)` for Chinese/mixed content until provider tokenizers are introduced.
- [ ] Reserve 20% context plus configured maximum output tokens.
- [ ] Commit `feat(interview): assemble cache-stable prompt segments`.

### Task 3: Build Stable Resume Evidence Index and JIT Loader

**Files:** `lib/interview/agent/context/resume-evidence.ts`, tests, `lib/interview/agent/composition.ts`, `tool-registry.ts`.

- [ ] Test deterministic ids derived from structured JSON paths and content hashes, stable ordering, bounded excerpts, missing-id errors, and no full-resume result unless explicitly requested by an allowed internal id.
- [ ] Index profile, skill, project, experience and education nodes into bounded evidence records.
- [ ] Replace the two coarse `resume:structured`/`resume:text` values with indexed records.
- [ ] Make `ask_interview_question` validate every evidence id against the interview snapshot index.
- [ ] Return structured `EVIDENCE_NOT_FOUND` errors with suggested search ids.
- [ ] Commit `feat(interview): load resume evidence just in time`.

### Task 4: Assemble Per-Turn Context from Durable State

**Files:** `lib/interview/agent/context/assembler.ts`, tests, `composition.ts`, `model-port.ts`, `runtime.ts`.

- [ ] Test stable prefix reuse across adjacent turns, compact deterministic coverage projection, recent raw tail, active checkpoint injection, user preference preservation and no run id before incremental tail.
- [ ] Query interview config, resume overview/evidence directory, latest snapshot, coverage and recent messages in parallel.
- [ ] Keep the latest 4 candidate/assistant pairs raw by default.
- [ ] Pass `{ system, stablePrefix, incrementalTail }` to the model port instead of serializing runtime internals.
- [ ] Record prompt template version and cache epoch on the run.
- [ ] Commit `feat(interview): build durable per-turn agent context`.

### Task 5: Implement Three-Level Compaction

**Files:** `lib/interview/agent/context/compaction.ts`, tests, `repository.ts`, `worker.ts`, `model-policy.ts`.

- [ ] Test level 1 pruning, level 2 structured summary, level 3 oldest-group truncation, tool-pair preservation, identifier preservation, 4-6 round cadence, token-pressure trigger, three-failure circuit breaker and terminal `prompt_too_long`.
- [ ] Level 1 removes reinjected static material and obsolete tool results without a model call.
- [ ] Level 2 uses a `context.compact` structured task to summarize facts, evidence, coverage and active threads while preserving a recent tail.
- [ ] Level 3 removes the oldest complete conversation groups and retries compaction once.
- [ ] Persist snapshot before advancing cache epoch.
- [ ] Run a pre-model context pressure check inside every tool-loop iteration.
- [ ] Commit `feat(interview): compact agent context with bounded recovery`.

### Task 6: Capture Cache and Token Telemetry

**Files:** `model-port.ts`, `repository.ts`, `context/telemetry.ts`, tests, README, `.env.example`.

- [ ] Normalize provider usage into input, cached input, cache write, output and compaction tokens when exposed.
- [ ] Compute cache hit ratio without treating missing provider fields as zero-cost hits.
- [ ] Persist per-run totals and structured diagnostic events.
- [ ] Document `INTERVIEW_AGENT_CONTEXT_WINDOW`, output reserve, recent-tail size and compaction cadence.
- [ ] Run migration twice, full tests, typecheck, lint and production build.
- [ ] Commit `docs(interview): document context budgets and cache telemetry`.

## Completion Gate

- Adjacent turns share a byte-identical stable prefix until an explicit cache epoch boundary.
- Full resume contents are absent from ordinary prompts.
- Context cannot exceed the effective budget without pruning/compaction.
- Tool pairs, evidence ids, preferences and coverage survive compaction.
- Three failed recovery levels produce `prompt_too_long`, never an infinite compact/retry loop.
- Cache and token telemetry is persisted when providers expose it.
