# Interview Agent Reliability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the reviewed Agent terminal-state, lease-renewal, idempotency, wake-cache, polling, and persistence-drift risks without changing the interview policy.

**Architecture:** Keep persisted Run state authoritative while making browser terminal convergence failure-safe. Introduce one single-flight lease heartbeat and one shared persistence-invariant module, then apply bounded memory and typed request-conflict semantics at existing boundaries.

**Tech Stack:** TypeScript strict mode, React 19, Next.js 16 App Router, Node test runner through `tsx`, Drizzle ORM, PostgreSQL, Zod, pnpm.

## Global Constraints

- Do not change the six-dimension scoring model or deterministic aggregates.
- Do not change the interview state machine, completion eligibility, category maximum of 3, or candidate-answer maximum of 20.
- Do not change resume snapshot semantics or add a database migration.
- Preserve persisted SSE sequence, replay cursor, lease owner/generation fencing, and recovery budget semantics.
- Write failing tests before each behavior change.
- Do not stage or commit changes unless the user explicitly requests it.

---

### Task 1: Centralize persistence invariants

**Files:**
- Create: `lib/interview/agent/persistence/invariants.ts`
- Create: `lib/interview/agent/persistence/invariants.test.ts`
- Modify: `lib/interview/agent/persistence/memory-repository.ts`
- Modify: `lib/interview/agent/persistence/drizzle-repository.ts`

**Interfaces:**
- Produces: `parseAuthorizedProposal(proposal, proposalHash): TurnProposalPrefix`
- Produces: `buildTerminalPayload(runId, input): TerminalRunPayload`
- Consumes: `turnProposalPrefixSchema`, `hashTurnProposalPrefix`, `terminalRunPayloadSchema`, and `agentExitMessage`

- [ ] **Step 1: Write invariant tests**

Add tests that call both helpers directly:

```ts
test("rejects a stale proposal hash and the reserved category topic", () => {
  const proposal = validProposalPrefix();
  assert.throws(() => parseAuthorizedProposal(proposal, "stale"), /hash is stale/i);
  assert.throws(
    () => parseAuthorizedProposal({
      ...proposal,
      coverageChanges: [{
        category: "projects",
        topic: "__category__",
        status: "partial",
        resumeEvidenceIds: [],
      }],
    }, hashTurnProposalPrefix({
      ...proposal,
      coverageChanges: [{
        category: "projects",
        topic: "__category__",
        status: "partial",
        resumeEvidenceIds: [],
      }],
    })),
    /Reserved coverage topic/i,
  );
});

test("builds one validated terminal payload policy", () => {
  assert.deepEqual(buildTerminalPayload("run-1", {
    exitReason: "aborted_streaming",
  }), {
    runId: "run-1",
    exitReason: "aborted_streaming",
    retryable: true,
    userMessage: "模型连接中断，请重试本轮回答。",
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/persistence/invariants.test.ts
```

Expected: failure because `persistence/invariants.ts` does not exist.

- [ ] **Step 3: Implement the shared helpers**

Create the module with the existing behavior:

```ts
export function parseAuthorizedProposal(
  proposal: TurnProposalPrefix,
  proposalHash: string,
): TurnProposalPrefix {
  const normalized = turnProposalPrefixSchema.parse(proposal);
  if (hashTurnProposalPrefix(normalized) !== proposalHash) {
    throw new Error("Agent proposal hash is stale");
  }
  if (normalized.coverageChanges.some((change) => change.topic === "__category__")) {
    throw new Error("Reserved coverage topic cannot be proposed");
  }
  return normalized;
}

export function buildTerminalPayload(
  runId: string,
  input: {
    exitReason: AgentExitReason;
    retryable?: boolean;
    userMessage?: string;
  },
) {
  return terminalRunPayloadSchema.parse({
    runId,
    exitReason: input.exitReason,
    retryable: input.retryable ?? input.exitReason === "aborted_streaming",
    userMessage: input.userMessage ?? agentExitMessage(input.exitReason),
  });
}
```

Import these functions in both repositories and delete their local copies.

- [ ] **Step 4: Verify shared behavior**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/persistence/invariants.test.ts lib/interview/agent/persistence/memory-repository.test.ts
npx tsc --noEmit
```

Expected: all focused tests pass and TypeScript reports no errors.

---

### Task 2: Reject conflicting answer idempotency replays

**Files:**
- Create: `lib/interview/agent/protocols/errors.ts`
- Create: `lib/interview/agent/protocols/errors.test.ts`
- Modify: `lib/interview/agent/persistence/invariants.ts`
- Modify: `lib/interview/agent/persistence/invariants.test.ts`
- Modify: `lib/interview/agent/persistence/interview-store.ts`
- Modify: `app/api/interviews/[id]/messages/route.ts`

**Interfaces:**
- Produces: `AgentRequestConflictError`
- Produces: `agentErrorHttpStatus(error): 409 | null`
- Produces: `assertMatchingCandidateAnswer(existingContent, requestedContent): void`

- [ ] **Step 1: Write conflict tests**

Cover same-body acceptance, different-body rejection, and HTTP status mapping:

```ts
test("accepts identical idempotent answer content", () => {
  assert.doesNotThrow(() => assertMatchingCandidateAnswer("回答", "回答"));
});

test("rejects a reused answer key with different content", () => {
  assert.throws(
    () => assertMatchingCandidateAnswer("旧回答", "新回答"),
    AgentRequestConflictError,
  );
});

test("maps Agent request conflicts to HTTP 409", () => {
  assert.equal(
    agentErrorHttpStatus(new AgentRequestConflictError("conflict")),
    409,
  );
  assert.equal(agentErrorHttpStatus(new Error("other")), null);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/protocols/errors.test.ts lib/interview/agent/persistence/invariants.test.ts
```

Expected: failure because the conflict interfaces do not exist.

- [ ] **Step 3: Implement typed conflict handling**

Add:

```ts
export class AgentRequestConflictError extends Error {
  readonly code = "AGENT_REQUEST_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "AgentRequestConflictError";
  }
}

export function agentErrorHttpStatus(error: unknown): 409 | null {
  return error instanceof AgentRequestConflictError ? 409 : null;
}
```

Add the persistence assertion:

```ts
export function assertMatchingCandidateAnswer(
  existingContent: string,
  requestedContent: string,
) {
  if (existingContent !== requestedContent) {
    throw new AgentRequestConflictError(
      "Idempotency key was already used for a different answer",
    );
  }
}
```

Call the assertion before returning the existing message in `acceptCandidateMessage`. In the API catch block, return:

```ts
const conflictStatus = agentErrorHttpStatus(error);
if (conflictStatus) {
  return NextResponse.json(
    { error: "Idempotency key conflicts with an existing answer" },
    { status: conflictStatus },
  );
}
```

- [ ] **Step 4: Verify conflict behavior**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/protocols/errors.test.ts lib/interview/agent/persistence/invariants.test.ts lib/interview/agent/application/interview-service.test.ts
npx tsc --noEmit
```

Expected: tests pass; same-body retry semantics remain unchanged.

---

### Task 3: Make lease renewal single-flight

**Files:**
- Create: `lib/interview/agent/application/lease-heartbeat.ts`
- Create: `lib/interview/agent/application/lease-heartbeat.test.ts`
- Modify: `lib/interview/agent/application/run-worker.ts`
- Modify: `lib/interview/agent/application/run-worker.test.ts`

**Interfaces:**
- Produces: `startLeaseHeartbeat(options): { stop(): Promise<void> }`
- Consumes: an async `renew(): Promise<boolean>` and `onLeaseLost(error): void`

- [ ] **Step 1: Write deterministic heartbeat tests**

Use a gated renewal to prove that the maximum concurrent renewals is one and that `stop()` waits:

```ts
test("never overlaps renewals and waits for an in-flight renewal on stop", async () => {
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const heartbeat = startLeaseHeartbeat({
    intervalMs: 1,
    async renew() {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return true;
    },
    onLeaseLost() {},
  });
  await waitUntil(() => active === 1);
  const stopping = heartbeat.stop();
  await Promise.resolve();
  assert.equal(active, 1);
  release();
  await stopping;
  assert.equal(maximum, 1);
  assert.equal(active, 0);
});
```

Also test that a false renewal calls `onLeaseLost` once and schedules no later renewal.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/application/lease-heartbeat.test.ts
```

Expected: failure because the heartbeat module does not exist.

- [ ] **Step 3: Implement and integrate the heartbeat**

Use one timer and one tracked promise:

```ts
export function startLeaseHeartbeat(options: {
  intervalMs: number;
  renew: () => Promise<boolean>;
  onLeaseLost: (error: unknown) => void;
}) {
  let stopped = false;
  let lost = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (stopped || lost) return;
    timer = setTimeout(() => {
      timer = null;
      inFlight = renewOnce();
    }, options.intervalMs);
  };
  const renewOnce = async () => {
    try {
      if (!(await options.renew())) {
        lost = true;
        options.onLeaseLost(new Error("Agent run lease was lost"));
      }
    } catch (error) {
      lost = true;
      options.onLeaseLost(error);
    } finally {
      schedule();
    }
  };
  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
```

Replace the worker interval with this heartbeat and call `await heartbeat.stop()` before releasing the lease.

- [ ] **Step 4: Verify worker recovery semantics**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/application/lease-heartbeat.test.ts lib/interview/agent/application/run-worker.test.ts lib/interview/agent/application/recovery.test.ts
npx tsc --noEmit
```

Expected: all focused tests pass, including stale-worker fencing and committed-message recovery.

---

### Task 4: Make terminal event delivery failure-safe

**Files:**
- Create: `lib/interview/agent/client/event-delivery.ts`
- Create: `lib/interview/agent/client/event-delivery.test.ts`
- Modify: `components/interview/use-agent-run-stream.ts`
- Modify: `components/interview/agent-interview-room.tsx`
- Modify: `lib/interview/agent/client/stream.test.ts`

**Interfaces:**
- Produces: `deliverAgentRunEvent(onEvent, event): Promise<"delivered" | "failed">`
- Preserves: cursor advancement before callback delivery and terminal replay behavior

- [ ] **Step 1: Write safe-delivery tests**

```ts
test("converts an async callback rejection into a failed delivery", async () => {
  const result = await deliverAgentRunEvent(
    async () => { throw new Error("refresh failed"); },
    event,
  );
  assert.equal(result, "failed");
});

test("reports a successful synchronous callback", async () => {
  assert.equal(await deliverAgentRunEvent(() => {}, event), "delivered");
});
```

Extend the room source contract to require a local terminal `setRun` before `await refresh()`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/client/event-delivery.test.ts lib/interview/agent/client/stream.test.ts
```

Expected: failure because safe delivery and local terminal convergence are absent.

- [ ] **Step 3: Implement safe callback observation**

Implement:

```ts
export async function deliverAgentRunEvent<T>(
  onEvent: (event: T) => void | Promise<void>,
  event: T,
) {
  try {
    await onEvent(event);
    return "delivered" as const;
  } catch {
    return "failed" as const;
  }
}
```

In the stream listener, close the source for terminal events, then observe delivery:

```ts
const terminal = type === "run_completed" || type === "run_failed";
if (terminal) source?.close();
void deliverAgentRunEvent(callbacksRef.current.onEvent, event).then((result) => {
  if (disposed || !terminal) return;
  setConnectionState(result === "delivered" ? "terminal" : "manual_retry");
});
```

In the room terminal cases, update `run.status`, `exitReason`, and `userMessage` locally before awaiting the authoritative refresh.

- [ ] **Step 4: Verify client behavior**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/client/*.test.ts components/interview/*.test.ts
npx tsc --noEmit
```

Expected: event parsing, cursor replay, reducer behavior, and failure-safe terminal delivery all pass.

---

### Task 5: Bound wake memory and reduce idle polling

**Files:**
- Modify: `lib/interview/agent/transport/postgres-wake-hub.ts`
- Modify: `lib/interview/agent/transport/postgres-wake-hub.test.ts`
- Modify: `app/api/interviews/[id]/runs/[runId]/events/route.ts`
- Modify: `lib/interview/agent/transport/sse.test.ts`
- Modify: `README.md`

**Interfaces:**
- Changes: `createInMemoryAgentEventWakeHub(options?: { maxRememberedRuns?: number })`
- Preserves: waiter wake-up and PostgreSQL notification behavior
- Changes default: `INTERVIEW_AGENT_EVENT_FALLBACK_MS` fallback from `1_500` to `5_000`

- [ ] **Step 1: Write bounded-memory tests**

```ts
test("evicts the oldest remembered run sequence at capacity", async () => {
  const hub = createInMemoryAgentEventWakeHub({ maxRememberedRuns: 2 });
  hub.publish({ runId: "run-a", latestSequence: 1 });
  hub.publish({ runId: "run-b", latestSequence: 1 });
  hub.publish({ runId: "run-c", latestSequence: 1 });
  assert.equal(
    await hub.waitForRun("run-a", 0, new AbortController().signal, 0),
    "timeout",
  );
  assert.equal(
    await hub.waitForRun("run-c", 0, new AbortController().signal, 0),
    "notified",
  );
});
```

Add a source-contract assertion for the 5-second route default.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/transport/postgres-wake-hub.test.ts lib/interview/agent/transport/sse.test.ts
```

Expected: failure because capacity configuration and the new fallback default are absent.

- [ ] **Step 3: Implement insertion-order eviction**

On publish, refresh insertion order and prune:

```ts
if (latestSequences.has(wake.runId)) latestSequences.delete(wake.runId);
latestSequences.set(wake.runId, latestSequence);
while (latestSequences.size > maxRememberedRuns) {
  const oldest = latestSequences.keys().next().value;
  if (oldest === undefined) break;
  latestSequences.delete(oldest);
}
```

Validate `maxRememberedRuns` as a positive integer and default it to `10_000`. Change the production fallback to `5_000` and document the default.

- [ ] **Step 4: Verify transport behavior**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/transport/*.test.ts
npx tsc --noEmit
```

Expected: wake, abort-listener cleanup, heartbeat, replay, and terminal compatibility tests pass.

---

### Task 6: Full verification and review

**Files:**
- Inspect: all files changed by Tasks 1–5
- Update only if required: `lib/interview/agent/README.md`

**Interfaces:**
- Consumes: all preceding task outputs
- Produces: verified, review-ready working tree

- [ ] **Step 1: Run all automated checks**

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
git diff --check
```

Expected:

- 0 test failures; database tests may retain their existing `DATABASE_URL` skips.
- 0 TypeScript errors.
- 0 ESLint errors; the existing shadcn example warning may remain.
- Successful Next.js production build.
- No whitespace errors.

- [ ] **Step 2: Verify architectural boundaries**

Run the existing directory dependency scan and confirm:

```text
NO DIRECTORY-LEVEL CYCLES
```

Also confirm client modules do not import persistence, provider, runtime, or transport implementations.

- [ ] **Step 3: Request independent code review**

Review the full working tree against `HEAD`, focusing on:

- terminal convergence after refresh rejection;
- maximum lease-renew concurrency of one;
- same-key/different-body answer rejection without state mutation;
- bounded wake memory and preserved active waiter delivery;
- parity between memory and Drizzle persistence behavior;
- absence of scoring, interview-flow, or snapshot changes.

- [ ] **Step 4: Resolve review findings**

Fix every Critical or Important finding, rerun the focused test for the affected module, then rerun all checks from Step 1.
