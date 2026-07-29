# Interview Agent Reliability Fixes Design

## Goal

Fix the reliability and maintainability issues found during the `lib/interview/agent` structure review without changing the PRD interview flow, scoring model, resume snapshot semantics, question limits, or completion policy.

## Scope

This change covers:

1. Terminal SSE event handling that can leave the room locally marked as running when the terminal refresh fails.
2. Overlapping asynchronous lease renewals in the Agent run worker.
3. Reuse of one answer idempotency key with a different answer body.
4. Unbounded remembered Run sequences in the PostgreSQL wake hub.
5. Excessive idle SSE fallback polling.
6. Duplicated persistence invariants in the in-memory and Drizzle repositories.
7. Tests for each changed behavior.

Large-file decomposition of `agent-runtime.ts`, the model provider, and repository implementations is explicitly deferred. Mixing those structural changes with concurrency fixes would increase review and rollback risk.

## Design

### Terminal event convergence

When a public `run_completed` or `run_failed` event arrives, the room must update the local Run object to its terminal status before starting the authoritative refresh. This immediately releases the local busy state.

The stream hook must observe the asynchronous event callback instead of discarding its promise. Callback failures must be caught. For a terminal callback failure, the hook enters `manual_retry` so the existing retry control can reconnect from the persisted cursor and query the authoritative Run status. No callback rejection may escape as an unhandled promise rejection.

Persisted SSE sequence handling remains unchanged: the cursor advances before delivery, duplicate events remain ignored, and a retry after a terminal event relies on the Run status endpoint when the terminal event is already behind the cursor.

### Single-flight lease renewal

The worker replaces `setInterval(async ...)` with a self-scheduling renewal loop. The next timer is scheduled only after the current `renewLease` call settles, so at most one renewal is active.

Stopping the heartbeat clears the next timer and waits for the in-flight renewal. A false renewal result or renewal exception marks the lease lost and aborts the executor exactly once. Lease owner and generation fencing remain unchanged.

### Answer idempotency conflict

An existing `(interviewId, idempotencyKey)` answer may be replayed only when its normalized stored content equals the normalized requested content. A different body raises a typed Agent request conflict.

The message API maps that conflict to HTTP `409`. Same-key/same-body retries continue returning the original message and Run without incrementing the candidate round count.

### Wake cache and fallback polling

The in-memory wake hub retains only a bounded number of latest Run sequences using insertion-order eviction. Evicting a remembered sequence is safe because the PostgreSQL event table remains authoritative; at worst, a later waiter reaches the normal polling fallback.

The production fallback interval increases from 1.5 seconds to 5 seconds while remaining configurable through `INTERVIEW_AGENT_EVENT_FALLBACK_MS`. PostgreSQL notifications continue delivering normal events immediately.

### Shared persistence invariants

Proposal normalization/hash verification, reserved coverage-topic rejection, and terminal event payload construction move to one persistence invariant module. Both repository implementations consume these functions. The public repository interface does not change.

## Error handling

- Terminal UI refresh failures become recoverable UI state instead of unhandled rejections.
- Lease renewal failures preserve the current `lease_lost` behavior.
- Answer idempotency body conflicts return `409` and never mutate interview state.
- Wake-cache eviction never deletes persisted events.

## Testing

Add or extend tests that verify:

- A terminal event updates local Run status before refresh and a rejected callback becomes retryable.
- Lease renewal concurrency never exceeds one and shutdown waits for an in-flight renewal.
- Same-key/same-body answer retries remain idempotent.
- Same-key/different-body requests produce the typed conflict and HTTP mapping.
- Wake sequence memory respects its configured capacity and still wakes active waiters.
- Both repository implementations use the same shared invariant behavior.

Run the complete unit suite, TypeScript check, ESLint, production build, dependency-cycle scan, and `git diff --check`.

## Non-goals

- No scoring, prompt, interview policy, schema, or database migration changes.
- No change to maximum rounds, category limits, completion eligibility, or recovery budget.
- No further decomposition of the large Runtime or provider files in this change.
