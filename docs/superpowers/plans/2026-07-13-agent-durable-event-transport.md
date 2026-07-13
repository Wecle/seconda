# Agent Durable Event Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PostgreSQL-only durable event transport that persists real reasoning/response deltas, wakes SSE with `LISTEN/NOTIFY`, and replays by sequence after reconnect.

**Architecture:** `interview_agent_events` remains the source of truth. Runtime writers coalesce small deltas before appending public events; the append transaction sends a small PostgreSQL notification after the event is durable. One process-local wake hub multiplexes a dedicated PostgreSQL listener to SSE generators, while a 1.5-second timeout query covers missed notifications.

**Tech Stack:** TypeScript strict mode, PostgreSQL, postgres.js 3.4, Drizzle ORM 0.45, Next.js 16 route handlers, Node test runner via `tsx`.

## Global Constraints

- PostgreSQL-only: do not add Redis, Kafka, queues, or another state store.
- The event table and committed messages are authoritative; `NOTIFY` is wake-up only.
- Persist coalesced deltas while the model is generating; never synthesize fixed-size chunks after commit.
- Default event visibility is `internal`; only explicitly public events may reach SSE.
- Keep `(run_id, sequence)` strictly monotonic and preserve fencing checks on every write.
- Use `LISTEN/NOTIFY` as the primary wake-up and 1–2 second polling only as fallback.
- Do not introduce runtime version branches or a V3 feature flag.
- Preserve the existing six-dimension scoring and interview state rules.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/interview/agent/contracts.ts` | Event names, visibility, payload schemas, durable event envelope |
| `lib/db/schema.ts` | Drizzle columns and public event index |
| `lib/db/migrate.ts` | Idempotent PostgreSQL schema migration |
| `lib/interview/agent/repository.ts` | Fenced event append, replay filtering, transactional `pg_notify` |
| `lib/interview/agent/event-coalescer.ts` | Time/size/punctuation delta batching |
| `lib/interview/agent/event-coalescer.test.ts` | Deterministic fake-clock batching tests |
| `lib/interview/agent/postgres-wake-hub.ts` | One listener connection per process and run-scoped wake promises |
| `lib/interview/agent/postgres-wake-hub.test.ts` | Hub race, timeout, cancellation, malformed payload tests |
| `lib/interview/agent/sse.ts` | Replay-first, notify-woken SSE generator |
| `lib/interview/agent/sse.test.ts` | Replay, heartbeat, fallback, and terminal close tests |
| `app/api/interviews/[id]/runs/[runId]/events/route.ts` | Ownership check and public SSE delivery |
| `lib/interview/agent/repository.integration.test.ts` | Real PostgreSQL visibility, notification, fencing, and ordering tests |

### Task 1: Durable event contracts and schema

**Files:**
- Modify: `lib/interview/agent/contracts.ts`
- Modify: `lib/interview/agent/stream-contracts.test.ts`
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`

**Interfaces:**
- Produces: `AgentEventVisibility`, `AgentEventType`, `AgentEventRecord`, `AgentEventInput`, and public payload schemas consumed by all later tasks.
- Produces database columns `attempt_id`, `logical_message_id`, and `visibility` on `interview_agent_events`.

- [ ] **Step 1: Write failing public event contract tests**

Add these cases to `lib/interview/agent/stream-contracts.test.ts`:

```ts
import {
  agentEventRecordSchema,
  messageCommittedPayloadSchema,
  publicAgentEventPayloadSchemas,
  publicAgentEventTypes,
  proposalAuthorizedPayloadSchema,
  reasoningDeltaPayloadSchema,
  responseDeltaPayloadSchema,
  responseDiscardedPayloadSchema,
  responseStartedPayloadSchema,
  toolCallCompletedPayloadSchema,
  toolCallStartedPayloadSchema,
} from "./contracts";

test("separates public reasoning and response channels", () => {
  assert.equal(reasoningDeltaPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    entryId: "reasoning:attempt-1",
    text: "先核对回答中的证据。",
  }).success, true);
  assert.equal(responseDeltaPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    text: "请介绍",
    provisional: true,
  }).success, true);
  assert.equal(responseStartedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
  }).success, true);
});

test("requires authorization and discard identity", () => {
  assert.equal(proposalAuthorizedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    proposalHash: "a".repeat(64),
  }).success, true);
  assert.equal(responseDiscardedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    reason: "provider_stream_failed",
  }).success, true);
});

test("tool progress exposes labels but not arguments or results", () => {
  assert.equal(toolCallStartedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    toolCallId: "call-1",
    toolName: "get_resume_evidence",
    publicLabel: "正在核对简历证据",
  }).success, true);
  assert.equal(toolCallCompletedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    toolCallId: "call-1",
    toolName: "get_resume_evidence",
    publicLabel: "已核对简历证据",
  }).success, true);
  assert.equal(toolCallCompletedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    toolCallId: "call-1",
    toolName: "get_resume_evidence",
    publicLabel: "已核对简历证据",
    result: { private: true },
  }).success, false);
});

test("defines one strict payload schema for every public event", () => {
  assert.deepEqual(
    Object.keys(publicAgentEventPayloadSchemas).sort(),
    [...publicAgentEventTypes].sort(),
  );
});

test("durable events carry explicit visibility and attempt identity", () => {
  assert.equal(agentEventRecordSchema.safeParse({
    id: "event-1",
    runId: "run-1",
    sequence: 7,
    type: "reasoning_delta",
    visibility: "public",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    payload: { text: "分析中" },
    createdAt: "2026-07-13T00:00:00.000Z",
  }).success, true);
  assert.equal(agentEventRecordSchema.safeParse({
    sequence: 7,
    type: "reasoning_delta",
    payload: {},
  }).success, false);
});

test("committed events carry the authoritative assistant message", () => {
  assert.equal(messageCommittedPayloadSchema.safeParse({
    runId: "run-1",
    attemptId: "attempt-1",
    logicalMessageId: "message-1",
    message: {
      id: "message-1",
      runId: "run-1",
      sequence: 4,
      role: "assistant",
      kind: "question",
      content: "请说明自动降级的触发条件？",
    },
  }).success, true);
  assert.equal(messageCommittedPayloadSchema.safeParse({
    runId: "run-1",
    logicalMessageId: "message-1",
  }).success, false);
});
```

Replace the existing `textDeltaPayloadSchema` and legacy `{ messageId, messageSequence }` committed-message assertions in this test file; do not leave both protocol shapes active. Keep the heartbeat separation assertion.

- [ ] **Step 2: Run the contract test and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/stream-contracts.test.ts
```

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Add the event types and strict payload schemas**

Add to `lib/interview/agent/contracts.ts`:

```ts
export const agentEventVisibilitySchema = z.enum(["public", "internal"]);

export const agentEventTypeSchema = z.enum([
  "run_started",
  "phase_changed",
  "attempt_started",
  "attempt_discarded",
  "reasoning_started",
  "reasoning_delta",
  "reasoning_completed",
  "tool_call_started",
  "tool_call_completed",
  "proposal_authorized",
  "response_started",
  "response_delta",
  "response_finished",
  "response_discarded",
  "artifact_committed",
  "scoring_progress",
  "reporting_started",
  "model_started",
  "warning",
  "checkpoint",
  "compacted",
  "message_committed",
  "run_completed",
  "run_failed",
]);

export const publicAgentEventTypes = [
  "run_started",
  "phase_changed",
  "attempt_started",
  "attempt_discarded",
  "reasoning_started",
  "reasoning_delta",
  "reasoning_completed",
  "tool_call_started",
  "tool_call_completed",
  "proposal_authorized",
  "response_started",
  "response_delta",
  "response_finished",
  "response_discarded",
  "artifact_committed",
  "scoring_progress",
  "reporting_started",
  "message_committed",
  "run_completed",
  "run_failed",
] as const satisfies readonly AgentEventType[];

export const publicAgentEventTypeSchema = z.enum(publicAgentEventTypes);
export type PublicAgentEventType = (typeof publicAgentEventTypes)[number];

export const reasoningDeltaPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  entryId: z.string().min(1).max(200),
  text: z.string().min(1),
}).strict();

export const proposalAuthorizedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const responseDeltaPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  text: z.string().min(1),
  provisional: z.literal(true),
}).strict();

export const responseDiscardedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  reason: z.string().min(1).max(100),
}).strict();

const toolCallLifecyclePayloadBaseSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.enum(["get_resume_evidence", "get_interview_history", "get_coverage_state"]),
  publicLabel: z.string().min(1).max(100),
});

export const toolCallStartedPayloadSchema = toolCallLifecyclePayloadBaseSchema.strict();
export const toolCallCompletedPayloadSchema = toolCallLifecyclePayloadBaseSchema.strict();

export const committedInterviewMessageSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(1),
  role: z.literal("assistant"),
  kind: interviewMessageKindSchema,
  content: z.string().min(1),
}).strict();

export const messageCommittedPayloadSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  logicalMessageId: z.string().min(1),
  message: committedInterviewMessageSchema,
}).strict();

export const agentEventRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(1),
  type: agentEventTypeSchema,
  visibility: agentEventVisibilitySchema,
  attemptId: z.string().min(1).nullable(),
  logicalMessageId: z.string().min(1).nullable(),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
}).strict();

export type AgentEventVisibility = z.infer<typeof agentEventVisibilitySchema>;
export type AgentEventRecord = z.infer<typeof agentEventRecordSchema>;
export type AgentEventInput = Omit<AgentEventRecord, "id" | "runId" | "sequence" | "visibility" | "createdAt"> & {
  visibility?: AgentEventVisibility;
  dedupeKey?: string;
};
```

Export `publicAgentEventPayloadSchemas` with `as const satisfies Record<PublicAgentEventType, ZodType>` so each key retains its inferred payload type, and validate every SSE payload through it. Use these exact public fields:

| Event | Strict payload fields |
| --- | --- |
| `run_started` | `runId`, `logicalMessageId` |
| `phase_changed` | `runId`, nullable `attemptId`, phase enum |
| `attempt_started` | `runId`, `attemptId`, `logicalMessageId`, positive `attemptNumber` |
| `attempt_discarded` | `runId`, `attemptId`, `logicalMessageId`, bounded `reason` |
| `reasoning_started` / `reasoning_completed` | `runId`, `attemptId`, `entryId` |
| `reasoning_delta` | fields in `reasoningDeltaPayloadSchema` |
| `tool_call_started` / `tool_call_completed` | fields in the corresponding lifecycle schema |
| `proposal_authorized` | fields in `proposalAuthorizedPayloadSchema` |
| `response_started` | `runId`, `attemptId`, `logicalMessageId` |
| `response_delta` | fields in `responseDeltaPayloadSchema` |
| `response_finished` | `runId`, `attemptId`, `logicalMessageId`, non-negative `characterCount` |
| `response_discarded` | fields in `responseDiscardedPayloadSchema` |
| `artifact_committed` / `scoring_progress` / `reporting_started` | retain their existing strict public schemas and add `attemptId` only when the producer has one |
| `message_committed` | fields in `messageCommittedPayloadSchema` |
| `run_completed` / `run_failed` | retain `terminalRunPayloadSchema` |

`AgentEventRecord` is the complete durable envelope from the architecture design; map PostgreSQL `created_at` to an ISO string at the repository boundary. `AgentEventRecord.visibility` remains required after persistence. `AgentEventInput.visibility` is temporarily optional so existing internal emitters keep compiling during the ordered migration; both repositories must materialize `event.visibility ?? "internal"`. Every new public emitter in these plans must pass `visibility: "public"` explicitly. Retain historical event names only where an existing persisted row still needs parsing; no new runtime path may emit `thinking_summary` or `text_delta`.

- [ ] **Step 4: Add the Drizzle columns and index**

Change `interviewAgentEvents` in `lib/db/schema.ts`:

```ts
attemptId: text("attempt_id"),
logicalMessageId: text("logical_message_id"),
visibility: text("visibility").notNull().default("internal"),
```

Add a PostgreSQL index in `lib/db/migrate.ts`:

```ts
await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS attempt_id TEXT`;
await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS logical_message_id TEXT`;
await sql`ALTER TABLE interview_agent_events ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'`;
await sql`CREATE INDEX IF NOT EXISTS idx_agent_events_public_replay ON interview_agent_events(run_id, sequence) WHERE visibility = 'public'`;
```

- [ ] **Step 5: Run contract, type, and migration checks**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/stream-contracts.test.ts
npx tsc --noEmit
pnpm db:migrate
```

Expected: contract test PASS, typecheck PASS, migration completes without error and is idempotent on a second run.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/contracts.ts lib/interview/agent/stream-contracts.test.ts lib/db/schema.ts lib/db/migrate.ts
git commit -m "feat(agent): add durable stream event contracts"
```

### Task 2: Fenced event append, visibility replay, and transactional notify

**Files:**
- Modify: `lib/interview/agent/repository.ts`
- Modify: `lib/interview/agent/repository.test.ts`
- Modify: `lib/interview/agent/repository.integration.test.ts`

**Interfaces:**
- Consumes: `AgentEventInput` and `AgentEventRecord` from Task 1.
- Produces: `appendEvent(runId, event, lease)` with explicit visibility metadata.
- Produces: `listEvents(runId, afterSequence, { visibility? })` for internal recovery and public SSE replay.

- [ ] **Step 1: Write failing repository visibility tests**

Add to `lib/interview/agent/repository.test.ts`:

```ts
test("replays only explicitly public events for SSE", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "visibility" });
  await repository.appendEvent(run.id, {
    type: "checkpoint", visibility: "internal", attemptId: null, logicalMessageId: null, payload: {},
  });
  await repository.appendEvent(run.id, {
    type: "reasoning_delta", visibility: "public", attemptId: "a1", logicalMessageId: "m1",
    payload: { runId: run.id, attemptId: "a1", entryId: "reasoning:a1", text: "公开" },
  });
  const events = await repository.listEvents(run.id, 0, { visibility: "public" });
  assert.deepEqual(events.map((event) => event.type), ["reasoning_delta"]);
});
```

- [ ] **Step 2: Run the repository test and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/repository.test.ts
```

Expected: FAIL because repository event inputs and filtering do not yet carry visibility.

- [ ] **Step 3: Change the repository interface and both implementations**

Use these signatures in `lib/interview/agent/repository.ts`:

```ts
appendEvent(
  runId: string,
  event: AgentEventInput,
  lease?: RunLeaseToken,
): Promise<{ sequence: number }>;

listEvents(
  runId: string,
  afterSequence: number,
  options?: { visibility?: AgentEventVisibility },
): Promise<AgentEventRecord[]>;
```

Remove the repository-local `AgentEventRecord` declaration and import the contract type. The in-memory implementation generates a stable event ID, copies `runId`, stores an ISO `createdAt`, materializes omitted input visibility as `internal`, and filters when `options.visibility` is present. The Drizzle implementation selects `id`, `runId`, `createdAt`, `attemptId`, `logicalMessageId`, and visibility, maps the timestamp to ISO, and inserts `attemptId`, `logicalMessageId`, plus `event.visibility ?? "internal"`.

- [ ] **Step 4: Notify only after the durable row exists**

Inside the same Drizzle transaction, immediately after the event insert, execute:

```ts
await tx.execute(sql`SELECT pg_notify(
  'interview_agent_events',
  ${JSON.stringify({ runId, latestSequence: run.sequence })}
)`);
```

Do not send a new notification when a dedupe key resolves to an existing event.

- [ ] **Step 5: Add a real PostgreSQL notification assertion**

In `lib/interview/agent/repository.integration.test.ts`, create a dedicated postgres.js listener before appending an event:

```ts
const notifications: string[] = [];
const listener = postgres(process.env.DATABASE_URL!, { prepare: false });
const listenRequest = await listener.listen("interview_agent_events", (value) => notifications.push(value));
await repository.appendEvent(runId, {
  type: "reasoning_started",
  visibility: "public",
  attemptId: "attempt-notify",
  logicalMessageId: "message-notify",
  payload: { runId, attemptId: "attempt-notify", entryId: "reasoning:attempt-notify" },
}, lease);
await waitUntil(() => notifications.length === 1);
assert.deepEqual(JSON.parse(notifications[0]), { runId, latestSequence: 1 });
await listenRequest.unlisten();
await listener.end();
```

Define `waitUntil` in that test file as a bounded 2-second loop using `setTimeout(10)`; throw a descriptive error when the deadline expires.

- [ ] **Step 6: Run unit and PostgreSQL integration tests**

```bash
pnpm exec tsx --test lib/interview/agent/repository.test.ts
pnpm exec tsx --env-file=.env --test lib/interview/agent/repository.integration.test.ts
```

Expected: PASS; the integration test may report SKIP only when `DATABASE_URL` is intentionally absent.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/repository.ts lib/interview/agent/repository.test.ts lib/interview/agent/repository.integration.test.ts
git commit -m "feat(agent): notify durable event appends"
```

### Task 3: Time- and boundary-based delta coalescer

**Files:**
- Create: `lib/interview/agent/event-coalescer.ts`
- Create: `lib/interview/agent/event-coalescer.test.ts`

**Interfaces:**
- Produces: `createEventCoalescer(options): EventCoalescer` consumed by the Runtime plan.
- Produces: `append(text)`, `flush()`, and `dispose()` with serialized writes.

- [ ] **Step 1: Write failing fake-clock coalescer tests**

Create `lib/interview/agent/event-coalescer.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createEventCoalescer } from "./event-coalescer";

test("flushes on punctuation, size, timer, and finalization", async () => {
  const writes: string[] = [];
  let scheduled: (() => void) | null = null;
  const coalescer = createEventCoalescer({
    intervalMs: 100,
    maxChars: 8,
    write: async (text) => { writes.push(text); },
    schedule: (_delay, callback) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: () => { scheduled = null; },
  });
  await coalescer.append("分析");
  assert.deepEqual(writes, []);
  scheduled?.();
  await coalescer.idle();
  await coalescer.append("候选人回答。继续");
  await coalescer.flush();
  assert.deepEqual(writes, ["分析", "候选人回答。", "继续"]);
  await coalescer.dispose();
});

test("serializes writes without losing suffixes", async () => {
  const writes: string[] = [];
  const coalescer = createEventCoalescer({ maxChars: 2, write: async (text) => { writes.push(text); } });
  await Promise.all([coalescer.append("甲"), coalescer.append("乙"), coalescer.append("丙")]);
  await coalescer.flush();
  assert.equal(writes.join(""), "甲乙丙");
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/event-coalescer.test.ts
```

Expected: FAIL because `event-coalescer.ts` does not exist.

- [ ] **Step 3: Implement the focused coalescer**

Export this contract from `event-coalescer.ts`:

```ts
export type EventCoalescer = {
  append(text: string): Promise<void>;
  flush(): Promise<void>;
  idle(): Promise<void>;
  dispose(): Promise<void>;
};

export function createEventCoalescer(options: {
  write: (text: string) => Promise<void>;
  intervalMs?: number;
  maxChars?: number;
  schedule?: (delayMs: number, callback: () => void) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}): EventCoalescer;
```

Use defaults `intervalMs = 100` and `maxChars = 64`. Split at the first natural boundary matching `/[。！？.!?\n]/u`, preserve every suffix, and chain writes through one promise so callbacks never race event sequence allocation.

- [ ] **Step 4: Run the coalescer tests**

```bash
pnpm exec tsx --test lib/interview/agent/event-coalescer.test.ts
```

Expected: PASS with no open timer handles.

- [ ] **Step 5: Commit**

```bash
git add lib/interview/agent/event-coalescer.ts lib/interview/agent/event-coalescer.test.ts
git commit -m "feat(agent): coalesce live stream events"
```

### Task 4: PostgreSQL wake hub and replay-first SSE

**Files:**
- Create: `lib/interview/agent/postgres-wake-hub.ts`
- Create: `lib/interview/agent/postgres-wake-hub.test.ts`
- Modify: `lib/interview/agent/sse.ts`
- Modify: `lib/interview/agent/sse.test.ts`
- Modify: `app/api/interviews/[id]/runs/[runId]/events/route.ts`

**Interfaces:**
- Produces: `AgentEventWakeHub.waitForRun(runId, afterSequence, signal, timeoutMs)`.
- Produces: `getPostgresAgentEventWakeHub()` singleton.
- Changes: `streamAgentEvents` replaces `pollAgentEvents` as the primary generator.

- [ ] **Step 1: Write failing wake and fallback tests**

Create `lib/interview/agent/postgres-wake-hub.test.ts` with a directly constructible in-memory hub:

```ts
test("wakes only the matching run and remembers the latest sequence", async () => {
  const hub = createInMemoryAgentEventWakeHub();
  const waiting = hub.waitForRun("run-a", 2, new AbortController().signal, 1_000);
  hub.publish({ runId: "run-b", latestSequence: 9 });
  hub.publish({ runId: "run-a", latestSequence: 3 });
  assert.equal(await waiting, "notified");
  assert.equal(await hub.waitForRun("run-a", 2, new AbortController().signal, 1_000), "notified");
});
```

Add to `lib/interview/agent/sse.test.ts`:

```ts
test("queries immediately after notify and falls back after 1500ms", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "sse-wake" });
  const controller = new AbortController();
  const waits: number[] = [];
  const wakeHub = {
    async waitForRun(_runId: string, _after: number, _signal: AbortSignal, timeoutMs: number) {
      waits.push(timeoutMs);
      await repository.appendEvent(run.id, {
        type: "reasoning_delta",
        visibility: "public",
        attemptId: "a1",
        logicalMessageId: "m1",
        payload: { runId: run.id, attemptId: "a1", entryId: "reasoning:a1", text: "分析" },
      });
      return "notified" as const;
    },
  };
  const received: AgentEventRecord[] = [];
  for await (const event of streamAgentEvents({
    repository,
    wakeHub,
    runId: run.id,
    afterSequence: 0,
    signal: controller.signal,
    fallbackMs: 1_500,
    heartbeatMs: 30_000,
  })) {
    if (event.type === "heartbeat") continue;
    received.push(event);
    break;
  }
  assert.deepEqual(received.map((event) => event.type), ["reasoning_delta"]);
  assert.deepEqual(waits, [1_500]);
});
```

The test setup must use the in-memory repository and append an explicitly public event.

- [ ] **Step 2: Run both tests and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/postgres-wake-hub.test.ts lib/interview/agent/sse.test.ts
```

Expected: FAIL because the wake hub and `streamAgentEvents` do not exist.

- [ ] **Step 3: Implement the wake hub**

Export:

```ts
export type AgentEventWake = { runId: string; latestSequence: number };
export type AgentEventWakeResult = "notified" | "timeout";
export interface AgentEventWakeHub {
  waitForRun(runId: string, afterSequence: number, signal: AbortSignal, timeoutMs: number): Promise<AgentEventWakeResult>;
}
export function createInMemoryAgentEventWakeHub(): AgentEventWakeHub & { publish(wake: AgentEventWake): void };
export function getPostgresAgentEventWakeHub(): AgentEventWakeHub;
```

The production singleton creates `postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })`, calls `listen("interview_agent_events", callback)`, validates payload with Zod, and forwards valid payloads to the same in-memory core. Register one process shutdown cleanup that calls `unlisten()` and `end()`; do not create one database listener per SSE request.

- [ ] **Step 4: Replace polling with replay-first wake waiting**

Rename `pollAgentEvents` to `streamAgentEvents` and use this loop shape:

```ts
while (!signal.aborted) {
  const events = await repository.listEvents(runId, cursor, { visibility: "public" });
  for (const event of events) {
    cursor = event.sequence;
    yield event;
  }
  const run = await repository.getRun(runId);
  if (!run || run.status !== "running") {
    yield* terminalCompatibilityDelivery(repository, runId, cursor);
    return;
  }
  const result = await wakeHub.waitForRun(runId, cursor, signal, fallbackMs);
  if (result === "timeout" && now() - lastDeliveryAt >= heartbeatMs) {
    yield { type: "heartbeat", serverTime: now().toISOString() };
  }
}
```

Default `fallbackMs` to `1_500`. Preserve abort-listener cleanup and heartbeat semantics.

- [ ] **Step 5: Wire the route to the singleton and remove the event allowlist**

In `app/api/interviews/[id]/runs/[runId]/events/route.ts`:

```ts
const wakeHub = getPostgresAgentEventWakeHub();
for await (const event of streamAgentEvents({
  repository,
  wakeHub,
  runId: run.id,
  afterSequence: resolveReplayCursor(parsedAfter.data, parsedLastEventId.data),
  signal: request.signal,
  heartbeatMs: readPositiveInteger(process.env.INTERVIEW_AGENT_HEARTBEAT_MS, 10_000),
  fallbackMs: readPositiveInteger(process.env.INTERVIEW_AGENT_EVENT_FALLBACK_MS, 1_500),
})) {
  controller.enqueue(encoder.encode(encodeSseEvent(event)));
}
```

Delete `PUBLIC_STREAM_EVENTS`; repository visibility is now the security boundary.

- [ ] **Step 6: Run transport tests and typecheck**

```bash
pnpm exec tsx --test lib/interview/agent/postgres-wake-hub.test.ts lib/interview/agent/sse.test.ts lib/interview/agent/repository.test.ts
npx tsc --noEmit
```

Expected: PASS; no MaxListeners warning and no unresolved timers.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/postgres-wake-hub.ts lib/interview/agent/postgres-wake-hub.test.ts lib/interview/agent/sse.ts lib/interview/agent/sse.test.ts 'app/api/interviews/[id]/runs/[runId]/events/route.ts'
git commit -m "feat(agent): wake SSE from PostgreSQL events"
```

### Task 5: Transport integration gate

**Files:**
- Modify: `lib/interview/agent/repository.integration.test.ts`
- Modify: `scripts/interview-agent-failure-contract.ts`

**Interfaces:**
- Consumes all interfaces from Tasks 1–4.
- Produces an integration gate proving durable-before-notify, cursor replay, and terminal close.

- [ ] **Step 1: Add a real database replay/notification/fencing scenario**

Extend the existing integration test so it:

```ts
function publicReasoningEvent(runId: string, attemptId: string, logicalMessageId: string, text: string): AgentEventInput {
  return {
    type: "reasoning_delta",
    visibility: "public",
    attemptId,
    logicalMessageId,
    payload: { runId, attemptId, entryId: `reasoning:${attemptId}`, text },
  };
}

const first = await repository.appendEvent(runId, publicReasoningEvent(runId, "a1", "m1", "甲"), activeLease);
const second = await repository.appendEvent(runId, publicReasoningEvent(runId, "a1", "m1", "乙"), activeLease);
assert.deepEqual(
  (await repository.listEvents(runId, first.sequence, { visibility: "public" })).map((event) => event.sequence),
  [second.sequence],
);
await assert.rejects(
  repository.appendEvent(runId, publicReasoningEvent(runId, "stale", "m1", "丙"), staleLease),
  /lease/i,
);
```

The helper above supplies the same attempt/logical identity in both envelope and payload so replay assertions also detect correlation drift.

- [ ] **Step 2: Update the failure contract to require public terminal events**

In `scripts/interview-agent-failure-contract.ts`, filter with:

```ts
const terminalEvents = (await repository.listEvents(run.id, 0, { visibility: "public" })).filter(
  (event) => event.type === "run_completed" || event.type === "run_failed",
);
```

Ensure `terminateRun` writes terminal events with `visibility: "public"` and all error/checkpoint detail remains internal.

- [ ] **Step 3: Run the complete transport gate**

```bash
pnpm exec tsx --test lib/interview/agent/event-coalescer.test.ts lib/interview/agent/postgres-wake-hub.test.ts lib/interview/agent/sse.test.ts lib/interview/agent/repository.test.ts
pnpm exec tsx --env-file=.env --test lib/interview/agent/repository.integration.test.ts
pnpm test
npx tsc --noEmit
pnpm lint
```

Expected: all configured tests PASS; PostgreSQL integration may SKIP only without `DATABASE_URL`; lint and typecheck exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/interview/agent/repository.integration.test.ts scripts/interview-agent-failure-contract.ts lib/interview/agent/repository.ts
git commit -m "test(agent): verify durable event transport"
```
