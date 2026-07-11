# Resumable Agent Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple Agent execution from request connections and deliver resumable, heartbeat-backed, persist-before-deliver event streaming with bounded exponential retry and explicit provisional-content semantics.

**Architecture:** Candidate-message requests persist input and enqueue a leased Agent run, then return `202` without waiting for a model. A background runner owns the run through a renewable database lease and appends ordered events. Clients consume SSE by `runId` and `after` sequence; the endpoint replays persisted events, sends heartbeats while idle, and closes on a terminal run. Stale runs can be claimed and resumed from checkpoints without duplicating messages or tool effects.

**Tech Stack:** TypeScript, Next.js App Router `after()`, PostgreSQL/Drizzle, Web `ReadableStream`, Vercel AI SDK structured streaming, Zod, Node test runner.

## Global Constraints

- Persist every business event before delivering it to a client.
- SSE heartbeat interval is 10 seconds; heartbeat is not provider progress.
- Provider idle timeout defaults to 25 seconds and is independently tracked.
- Retry transient 408, 429, 5xx, network and idle-timeout failures only.
- Use full-jitter exponential backoff with 500 ms base, factor 2, 8 second cap, and at most 2 transient retries per model.
- Model fallback order remains fast primary, fast fallback, quality primary, quality fallback.
- Before user-visible provisional content, retry/fallback may be transparent.
- After provisional content, never concatenate output from a different attempt or model into the same message.
- `message_committed` is the only signal that candidate-visible content is durable.
- Message submission and worker recovery remain idempotent.
- This plan does not implement Prompt Pipe compaction or the new room UI.

---

### Task 1: Add Run Lease and Stream Contracts

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`
- Modify: `lib/interview/agent/contracts.ts`
- Create: `lib/interview/agent/stream-contracts.test.ts`

**Interfaces:**
- Produces: lease columns, `AgentStreamEvent`, `RunLease`, provisional event contracts.

- [ ] Add failing schema tests for `text_delta` requiring `messageId`, `attemptId`, `text`, and `provisional: true`; `message_committed` requiring `messageId` and sequence; heartbeat requiring no transcript mutation.
- [ ] Run `pnpm exec tsx --test lib/interview/agent/stream-contracts.test.ts` and expect failure.
- [ ] Add `lease_owner`, `lease_expires_at`, `attempt_id`, `attempt_number`, `provisional_message_id`, `last_provider_progress_at`, and `resume_count` to `interview_agent_runs` as additive nullable/defaulted columns.
- [ ] Add Zod event payload schemas and inferred types in `contracts.ts`.
- [ ] Add idempotent SQL alterations and index `(status, lease_expires_at)`.
- [ ] Run migration twice, tests, and `npx tsc --noEmit`.
- [ ] Commit with `feat(interview): add resumable run lease contracts`.

### Task 2: Extend Repository for Replay, Claim and Lease Renewal

**Files:**
- Modify: `lib/interview/agent/repository.ts`
- Modify: `lib/interview/agent/repository.test.ts`

**Interfaces:**
- Produces: `getRun()`, `listEvents(runId, after)`, `claimRun()`, `renewLease()`, `releaseLease()`.

- [ ] Add failing contract tests for ordered replay after a cursor, one winner among concurrent claims, rejection of an unexpired foreign lease, stale-lease takeover incrementing `resumeCount`, and lease-owner-only renewal.
- [ ] Implement in-memory behavior first.
- [ ] Implement PostgreSQL claim with one conditional `UPDATE ... WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at < now() OR lease_owner = owner) RETURNING`.
- [ ] Use a 30-second lease and renew at most every 10 seconds.
- [ ] Ensure terminal transitions clear lease columns.
- [ ] Run repository tests and typecheck.
- [ ] Commit with `feat(interview): claim and replay persistent agent runs`.

### Task 3: Add Agent Retry and Attempt Controller

**Files:**
- Create: `lib/interview/agent/attempt-controller.ts`
- Create: `lib/interview/agent/attempt-controller.test.ts`
- Modify: `lib/ai/model-errors.ts`

**Interfaces:**
- Produces: `runAgentAttempts()` with attempt/model metadata and accepted-content boundary.

- [ ] Write table-driven tests for 408/429/500/network/idle retry, fatal auth/schema errors, full-jitter delays within `[0, min(8000, 500*2^retry)]`, two retries per candidate, candidate fallback before provisional content, and immediate `aborted_streaming` after provisional content.
- [ ] Inject `sleep`, `random`, and clock for deterministic tests.
- [ ] Persist `model_started` with attempt id/model and update run attempt fields before invoking a provider.
- [ ] Mark accepted content only after the first non-empty provisional delta callback.
- [ ] Return a new provisional message id for each attempt; never reuse it across fallback.
- [ ] Run attempt tests and existing AI error tests.
- [ ] Commit with `feat(interview): retry bounded agent model attempts`.

### Task 4: Stream Structured Agent Steps with Provider Idle Detection

**Files:**
- Modify: `lib/interview/agent/model-port.ts`
- Create: `lib/interview/agent/model-port.test.ts`
- Modify: `lib/interview/agent/runtime.ts`
- Modify: `lib/interview/agent/runtime.test.ts`

**Interfaces:**
- Produces: `nextStepStream({ onProvisionalDelta, onProviderProgress })`.

- [ ] Add scripted-stream tests for partial `ask_interview_question.args.question` deltas, no duplicate delta text, 25-second provider idle abort, tool-only progress resetting idle time, final schema validation, and no fallback after the first provisional delta.
- [ ] Extend the model port with a streaming result while retaining the non-streaming fake port used by unit tests.
- [ ] Use `streamStructured({ task: 'interview.agent' })`; treat growing partial question text as provisional and emit only the suffix.
- [ ] Race provider iteration against an injectable idle timer and abort the attempt on expiry.
- [ ] Append `text_delta` events before invoking delivery callbacks.
- [ ] On successful question tool execution append `message_committed` referencing the provisional message id.
- [ ] On failure after provisional content append `run_failed` with `aborted_streaming`; do not create a second attempt in that run.
- [ ] Run model-port/runtime tests and typecheck.
- [ ] Commit with `feat(interview): stream provisional agent questions safely`.

### Task 5: Implement Leased Background Run Worker

**Files:**
- Create: `lib/interview/agent/worker.ts`
- Create: `lib/interview/agent/worker.test.ts`
- Modify: `lib/interview/agent/service.ts`
- Modify: `lib/interview/agent/service.test.ts`
- Modify: `lib/interview/agent/composition.ts`

**Interfaces:**
- Produces: `scheduleAgentRun()`, `executeClaimedRun()`, `resumeStaleRun()`.

- [ ] Add failing tests proving message submission returns before executor completion, duplicate schedules execute once, lease loss stops execution, renewal occurs during a long attempt, stale checkpoint resumes, and terminal runs are not re-executed.
- [ ] Split `submitCandidateMessage()` into durable preparation returning `runId`, then scheduling through an injected scheduler.
- [ ] Use Next.js `after()` only as the first execution trigger; correctness must depend on the persisted run and lease, not on callback survival.
- [ ] Reconstruct mode/instruction from persisted trigger message and checkpoint, not request memory.
- [ ] Renew the lease during model/tool work and stop if renewal fails.
- [ ] Run worker/service tests.
- [ ] Commit with `feat(interview): execute agent runs behind durable leases`.

### Task 6: Add SSE Replay and Heartbeats

**Files:**
- Create: `app/api/interviews/[id]/runs/[runId]/events/route.ts`
- Create: `lib/interview/agent/sse.ts`
- Create: `lib/interview/agent/sse.test.ts`

**Interfaces:**
- Produces: authenticated `GET .../events?after=<sequence>` SSE stream.

- [ ] Test SSE encoding, cursor replay, ordered events, 10-second heartbeat, no heartbeat persistence, terminal close, abort cleanup, and ownership rejection.
- [ ] Validate `after` as an integer `>= 0` and both ids as UUIDs.
- [ ] Poll persisted events with bounded 500 ms–1 s cadence; do not hold database transactions open.
- [ ] Emit SSE ids equal to event sequence and event names equal to event type.
- [ ] Emit `heartbeat` with current server time only after 10 seconds without a business event.
- [ ] Close after all events for a terminal run have been delivered.
- [ ] Set `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and disable buffering where supported.
- [ ] Run SSE tests and build.
- [ ] Commit with `feat(api): replay agent events over SSE`.

### Task 7: Add Explicit Recovery Endpoint

**Files:**
- Create: `app/api/interviews/[id]/runs/[runId]/resume/route.ts`
- Create: `lib/interview/agent/recovery.test.ts`
- Modify: `lib/interview/agent/worker.ts`

**Interfaces:**
- Produces: authenticated idempotent run recovery.

- [ ] Test active lease returns `202 already_running`, stale lease schedules recovery, terminal run returns its final status, wrong interview/run pairing returns 404, and repeated resume calls create one owner.
- [ ] Authorize through interview ownership before exposing run state.
- [ ] Claim only stale/unleased runs and schedule `executeClaimedRun()` through `after()`.
- [ ] Preserve the same run id and checkpoint; increment `resumeCount`.
- [ ] Run recovery tests and build.
- [ ] Commit with `feat(api): resume interrupted agent runs`.

### Task 8: Final Streaming Verification and Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `scripts/interview-agent-contract.ts`

**Interfaces:**
- Produces: operational defaults and a reconnecting live contract.

- [ ] Document lease duration, heartbeat interval, provider idle timeout, retry/fallback order, provisional/committed semantics, and recovery endpoint.
- [ ] Extend live contract to disconnect after a provisional delta, reconnect with the last event sequence, verify no duplicate committed message, and assert every run is terminal or has an unexpired lease.
- [ ] Run migration twice, `pnpm test`, `npx tsc --noEmit`, `pnpm lint`, and `pnpm build`.
- [ ] Run the live contract only when `INTERVIEW_AGENT_TEST_RESUME_VERSION_ID` is configured; otherwise report it as skipped.
- [ ] Commit with `docs(interview): document resumable agent streaming`.

## Rollback Plan

1. Keep `INTERVIEW_AGENT_V2_ENABLED=false` to stop new Agent traffic.
2. Disable event streaming routes without deleting persisted events.
3. Stop scheduling new workers; leased runs expire and remain recoverable.
4. Revert API scheduling to synchronous execution only for development diagnosis, never as production recovery behavior.

## Completion Gate

- No candidate-visible message exists without `message_committed`.
- Replaying from any sequence produces the same ordered suffix.
- Browser disconnect never aborts the provider attempt.
- A crashed worker becomes claimable after lease expiry.
- No attempt falls back after provisional content is exposed.
- All existing v1 and Agent MVP tests remain green.
