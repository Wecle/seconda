# Agent Live Reasoning Room and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the durable reasoning/response protocol correctly in the interview room, reconcile committed messages without refresh waterfalls, and directly cut all active interviews to the latest Runtime without V1/V2/V3 execution branches.

**Architecture:** A pure reducer owns attempt-scoped reasoning, provisional response, committed-message reconciliation, and panel expansion. EventSource callbacks remain stable through refs and dispatch typed events; a memoized live-turn component isolates frequent stream updates. The room snapshot loads authoritative messages plus explicit public events. A one-time PostgreSQL cutover fences existing workers, reconciles already-committed runs, resets only provisional attempts, and resumes unfinished runs on the latest executor.

**Tech Stack:** React 19, Next.js 16 App Router, TypeScript, EventSource/SSE, Tailwind CSS v4, PostgreSQL, Node test runner, existing shadcn/ui components.

## Global Constraints

- Reasoning starts expanded by default.
- A manual collapse during reasoning remains respected until response starts.
- `response_started` automatically collapses reasoning and starts genuine response rendering.
- Users may reopen completed reasoning at any time.
- Attempt repair preserves reasoning history but clears discarded provisional response text.
- Only `message_committed` creates a formal transcript message.
- Use the authoritative message carried by `message_committed`; do not fetch the whole room after every commit.
- EventSource effects use primitive dependencies and callback refs; do not reconnect on every render.
- Keep high-frequency stream rendering isolated from the whole room component.
- Remove `INTERVIEW_AGENT_V2_ENABLED` and do not add a V3 flag.
- Keep completed historical data readable; all active execution uses the latest Agent Runtime.
- PostgreSQL remains the only durable state and coordination system.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/interview/agent/room-state.ts` | Pure event-to-room reducer and replay hydration |
| `lib/interview/agent/room-state.test.ts` | Expansion, attempts, discard, commit, dedupe tests |
| `components/interview/agent-live-turn.tsx` | Memoized high-frequency reasoning/response rendering |
| `components/interview/agent-thinking-panel.tsx` | Accessible expandable reasoning history |
| `components/interview/agent-interview-room.tsx` | Message submission and typed event dispatch |
| `components/interview/use-agent-run-stream.ts` | Stable EventSource lifecycle and cursor tracking |
| `app/api/interviews/[id]/route.ts` | Authoritative room snapshot and public event hydration |
| `app/(app)/interviews/[interviewId]/room/page.tsx` | Latest active Agent room selection |
| `lib/interview/agent/feature.ts` | Removed V2 rollback switch |
| `scripts/agent-runtime-cutover.ts` | One-time active-run fencing/reconciliation/resume |
| `scripts/interview-agent-ui-contract.ts` | Deterministic reducer/SSE end-to-end event contract |

### Task 1: Attempt-scoped room reducer

**Files:**
- Modify: `lib/interview/agent/room-state.ts`
- Modify: `lib/interview/agent/room-state.test.ts`
- Modify: `lib/interview/agent/contracts.ts`

**Interfaces:**
- Produces: `LiveTurnState`, `ReasoningEntry`, and typed `AgentRoomAction`.
- Consumes the public event names from the durable transport plan.

- [ ] **Step 1: Write failing reducer behavior tests**

```ts
function committedMessage(content: string, id = "m1"): CommittedInterviewMessage {
  return {
    id,
    runId: "r1",
    sequence: 2,
    role: "assistant",
    kind: "question",
    content,
  };
}

function reasoningState(): AgentRoomState {
  let state = initialAgentRoomState([], [], []);
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r1", logicalMessageId: "m1" });
  state = agentRoomReducer(state, { type: "attempt_started", runId: "r1", attemptId: "a1", logicalMessageId: "m1" });
  state = agentRoomReducer(state, { type: "reasoning_started", runId: "r1", attemptId: "a1" });
  return agentRoomReducer(state, { type: "reasoning_delta", runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "核对证据。" });
}

function respondingState(input: { text: string }): AgentRoomState {
  let state = reasoningState();
  state = agentRoomReducer(state, { type: "response_started", runId: "r1", attemptId: "a1", logicalMessageId: "m1" });
  return agentRoomReducer(state, { type: "response_delta", runId: "r1", attemptId: "a1", logicalMessageId: "m1", text: input.text, provisional: true });
}

test("expands reasoning then collapses when response starts", () => {
  let state = initialAgentRoomState([], [], []);
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r1", logicalMessageId: "m1" });
  state = agentRoomReducer(state, { type: "reasoning_started", runId: "r1", attemptId: "a1" });
  assert.equal(state.turns.r1.thinking.expanded, true);
  state = agentRoomReducer(state, { type: "reasoning_delta", runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "核对证据。" });
  state = agentRoomReducer(state, { type: "response_started", runId: "r1", attemptId: "a1", logicalMessageId: "m1" });
  assert.equal(state.turns.r1.thinking.expanded, false);
  assert.equal(state.turns.r1.phase, "responding");
});

test("respects manual collapse while reasoning continues", () => {
  let state = reasoningState();
  state = agentRoomReducer(state, { type: "thinking_toggled", runId: "r1", expanded: false });
  state = agentRoomReducer(state, { type: "reasoning_delta", runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "继续分析。" });
  assert.equal(state.turns.r1.thinking.expanded, false);
});

test("updates a public read-tool progress entry without exposing data", () => {
  let state = reasoningState();
  state = agentRoomReducer(state, { type: "tool_call_started", runId: "r1", attemptId: "a1", toolCallId: "call-1", publicLabel: "正在核对简历证据" });
  state = agentRoomReducer(state, { type: "tool_call_completed", runId: "r1", attemptId: "a1", toolCallId: "call-1", publicLabel: "已核对简历证据" });
  const entry = state.turns.r1.reasoningEntries.find((candidate) => candidate.entryId === "tool:call-1");
  assert.deepEqual(entry, {
    entryId: "tool:call-1",
    attemptId: "a1",
    kind: "tool",
    text: "已核对简历证据",
    status: "completed",
    discarded: false,
  });
});

test("discards response but preserves reasoning across attempts", () => {
  let state = respondingState({ text: "旧问题" });
  state = agentRoomReducer(state, { type: "response_discarded", runId: "r1", attemptId: "a1", logicalMessageId: "m1", reason: "provider_stream_failed" });
  state = agentRoomReducer(state, { type: "attempt_started", runId: "r1", attemptId: "a2", logicalMessageId: "m1" });
  assert.equal(state.turns.r1.provisionalResponse, "");
  assert.equal(state.turns.r1.reasoningEntries.some((entry) => entry.attemptId === "a1"), true);
  assert.equal(state.turns.r1.currentAttemptId, "a2");
});

test("reconciles the authoritative committed message without refresh", () => {
  let state = respondingState({ text: "最终问题？" });
  state = agentRoomReducer(state, { type: "message_committed", runId: "r1", logicalMessageId: "m1", message: committedMessage("最终问题？") });
  assert.equal(state.turns.r1.provisionalResponse, "");
  assert.equal(state.messages.filter((message) => message.id === "m1").length, 1);
});
```

Import `CommittedInterviewMessage` from the durable event contracts. The helpers above deliberately build state only through the public reducer actions, so the tests also exercise the normal attempt lifecycle.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/room-state.test.ts
```

Expected: FAIL because the current reducer uses summary entries and has no attempt/discard semantics.

- [ ] **Step 3: Define the new reducer state**

```ts
export type ReasoningEntry = {
  entryId: string;
  attemptId: string;
  kind: "reasoning" | "tool";
  text: string;
  status: "streaming" | "completed";
  discarded: boolean;
};

export type LiveTurnState = {
  runId: string;
  logicalMessageId: string | null;
  currentAttemptId: string | null;
  phase: "reasoning" | "responding" | "committing" | "failed";
  reasoningEntries: ReasoningEntry[];
  thinking: { expanded: boolean; userToggled: boolean; failed: boolean };
  provisionalResponse: string;
  responseStarted: boolean;
  lastSequence: number;
};
```

Reducer actions must include `attempt_started`, `reasoning_started`, `reasoning_delta`, `reasoning_completed`, `tool_call_started`, `tool_call_completed`, `proposal_authorized`, `response_started`, `response_delta`, `response_finished`, `response_discarded`, `attempt_discarded`, `message_committed`, and terminal events. Tool actions use only the sanitized `publicLabel`; raw tool arguments and results are not part of room state.

Expansion is reducer state, not an effect: the first `reasoning_started` for a turn sets `expanded: true` only while `userToggled` is false; `thinking_toggled` sets both the requested value and `userToggled: true`; later reasoning/tool deltas never change it; every `response_started` sets `expanded: false`; a later user toggle may reopen the completed reasoning. Replay produces the same result, so hydration during `responding` or after commit is collapsed.

- [ ] **Step 4: Implement sequence dedupe and replay hydration**

Ignore any event with `sequence <= turn.lastSequence`. `initialAgentRoomState` folds sorted public events through the same reducer so reconnect and initial load share one behavior path. A `message_committed` payload inserts/replaces the authoritative message and clears provisional response.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/room-state.test.ts lib/interview/agent/stream-contracts.test.ts
npx tsc --noEmit
git add lib/interview/agent/room-state.ts lib/interview/agent/room-state.test.ts lib/interview/agent/contracts.ts
git commit -m "feat(interview): reduce live agent attempts"
```

Expected: tests and typecheck PASS.

### Task 2: Stable EventSource event delivery

**Files:**
- Modify: `components/interview/use-agent-run-stream.ts`
- Modify: `lib/interview/agent/client-stream.test.ts`
- Create: `lib/interview/agent/client-event.ts`
- Create: `lib/interview/agent/client-event.test.ts`

**Interfaces:**
- Produces: `parseAgentRunStreamEvent(type, message): AgentRunStreamEvent | null`.
- Preserves: cursor, bounded reconnect, run recovery, callback refs.

- [ ] **Step 1: Write failing client event tests**

```ts
test("parses only public persisted events with a positive cursor", () => {
  const event = parseAgentRunStreamEvent("reasoning_delta", {
    lastEventId: "7",
    data: JSON.stringify({ runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "分析" }),
  });
  assert.deepEqual(event, {
    type: "reasoning_delta",
    sequence: 7,
    payload: { runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "分析" },
  });
  assert.equal(parseAgentRunStreamEvent("checkpoint", { lastEventId: "8", data: "{}" }), null);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/client-event.test.ts lib/interview/agent/client-stream.test.ts
```

Expected: FAIL because `client-event.ts` is missing and the hook still lists internal/legacy events.

- [ ] **Step 3: Implement strict event parsing**

Use `agentStreamEventSchema`, `publicAgentEventTypeSchema`, and `publicAgentEventPayloadSchemas[type]` from contracts. Return `null` for invalid JSON, a payload that fails its event-specific schema, non-positive sequence, heartbeat with a persisted sequence, or internal event names. The returned discriminated union must narrow payload type by `event.type`, so the room component does not cast `unknown`.

- [ ] **Step 4: Update the EventSource effect**

Register only current public event names. Keep `onEvent` and `onTerminal` in refs, keep effect dependencies primitive (`interviewId`, `runId`, `runStatus`, `afterSequence`, `retryVersion`), and update `cursorRef` before dispatch. Do not place callback props in the dependency list.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/client-event.test.ts lib/interview/agent/client-stream.test.ts
npx tsc --noEmit
git add components/interview/use-agent-run-stream.ts lib/interview/agent/client-event.ts lib/interview/agent/client-event.test.ts lib/interview/agent/client-stream.test.ts
git commit -m "refactor(interview): type agent stream events"
```

Expected: tests and typecheck PASS.

### Task 3: Live reasoning and response components

**Files:**
- Create: `components/interview/agent-live-turn.tsx`
- Create: `components/interview/agent-live-turn.test.tsx`
- Modify: `components/interview/agent-thinking-panel.tsx`
- Modify: `components/interview/agent-interview-room.tsx`

**Interfaces:**
- Consumes: `LiveTurnState` and reducer actions.
- Produces: memoized `AgentLiveTurn` with accessible reasoning disclosure.

- [ ] **Step 1: Write failing static render tests**

```tsx
const baseTurn: LiveTurnState = {
  runId: "r1",
  logicalMessageId: "m1",
  currentAttemptId: "a1",
  phase: "reasoning",
  reasoningEntries: [],
  thinking: { expanded: true, userToggled: false, failed: false },
  provisionalResponse: "",
  responseStarted: false,
  lastSequence: 0,
};

function liveTurn(overrides: Partial<LiveTurnState>): LiveTurnState {
  return { ...baseTurn, ...overrides };
}

test("renders expanded reasoning and provisional response", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      phase: "responding",
      reasoningEntries: [{ entryId: "e1", attemptId: "a1", kind: "reasoning", text: "先核对证据。", status: "completed", discarded: false }],
      provisionalResponse: "请说明自动降级条件？",
      thinking: { expanded: true, userToggled: true, failed: false },
    })}
    active
    onToggle={() => {}}
  />);
  assert.match(html, /先核对证据/);
  assert.match(html, /请说明自动降级条件/);
  assert.match(html, /aria-expanded="true"/);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test components/interview/agent-live-turn.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused rendering component**

Export `AgentLiveTurn = memo(function AgentLiveTurn(...))`. Render `AgentThinkingPanel` and provisional Markdown. Give long reasoning containers `[content-visibility:auto]`, `whitespace-pre-wrap`, and an accessible toggle. Mark discarded attempts with the visible label “已调整方案”; do not expose failure internals.

- [ ] **Step 4: Dispatch the new protocol in the room**

Replace the event `if` chain with a typed `switch`. `message_committed` dispatches the authoritative message from the payload and does not call `refresh()`. Terminal events may refresh interview/completion status once. Extract live-turn rendering outside `AgentInterviewRoom` so each delta does not recreate the full transcript rendering function.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec tsx --test components/interview/agent-live-turn.test.tsx lib/interview/agent/room-state.test.ts
npx tsc --noEmit
git add components/interview/agent-live-turn.tsx components/interview/agent-live-turn.test.tsx components/interview/agent-thinking-panel.tsx components/interview/agent-interview-room.tsx
git commit -m "feat(interview): render live reasoning turns"
```

Expected: tests and typecheck PASS.

### Task 4: Authoritative snapshot hydration

**Files:**
- Modify: `app/api/interviews/[id]/route.ts`
- Modify: `app/(app)/interviews/[interviewId]/room/page.tsx`
- Modify: `lib/interview/agent/room-state.test.ts`

**Interfaces:**
- Produces: `agentState.publicEvents` containing only explicit public events and all event envelope fields.
- Produces: active interviews always rendered by `AgentInterviewRoom`.

- [ ] **Step 1: Write a failing hydration test**

```ts
test("hydrates an active response as collapsed without duplicating committed text", () => {
  const message = committedMessage("最终问题？");
  const state = initialAgentRoomState(
    [message],
    [],
    [
      roomEvent(1, "reasoning_started", { runId: "r1", attemptId: "a1" }),
      roomEvent(2, "reasoning_delta", { runId: "r1", attemptId: "a1", entryId: "reasoning:a1", text: "分析" }),
      roomEvent(3, "response_started", { runId: "r1", attemptId: "a1", logicalMessageId: "m1" }),
      roomEvent(4, "response_delta", { runId: "r1", attemptId: "a1", logicalMessageId: "m1", text: "最终问题？", provisional: true }),
      roomEvent(5, "message_committed", { runId: "r1", attemptId: "a1", logicalMessageId: "m1", message }),
    ],
  );
  assert.equal(state.turns.r1.thinking.expanded, false);
  assert.equal(state.turns.r1.provisionalResponse, "");
  assert.equal(state.messages.filter((message) => message.id === "m1").length, 1);
});
```

Define this helper beside the test; `committedMessage` is the fully typed helper already introduced in Task 1:

```ts
function roomEvent(sequence: number, type: AgentEventType, payload: unknown): PublicRoomEvent {
  return { runId: "r1", sequence, type, payload };
}
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/room-state.test.ts
```

Expected: FAIL until the reducer and API shape use the new envelope.

- [ ] **Step 3: Query public events by visibility**

In `app/api/interviews/[id]/route.ts`, define `const usesAgentRoom = interview.status === "active" || interview.configVersion === 2`. Use it for the message, event, run, completion-job queries and the returned `agentState`; this removes the four direct `configVersion === 2` query branches while preserving completed legacy history. Keep independent queries in the existing `Promise.all`, select `attemptId`, `logicalMessageId`, and `visibility`, and filter with `eq(interviewAgentEvents.visibility, "public")`. Remove the hard-coded `inArray` event-type list. Return events ordered by run creation and sequence.

- [ ] **Step 4: Route all active interviews to the latest room**

Change the page decision to:

```tsx
if (interview?.status === "active" || interview?.configVersion === 2) {
  return <AgentInterviewRoom
    interviewId={String(interviewId)}
    initialMessages={agentState?.messages ?? []}
    initialRun={agentState?.latestRun ?? null}
    resumeSnapshot={resumeSnapshot}
    status={interview.status}
    initialScoringProgress={agentState?.scoringProgress ?? null}
    initialArtifacts={agentState?.artifacts ?? []}
    initialEvents={agentState?.publicEvents ?? []}
  />;
}
```

Completed legacy interviews remain readable through existing report/history paths; there is no alternate active execution loop.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/room-state.test.ts
npx tsc --noEmit
git add 'app/api/interviews/[id]/route.ts' 'app/(app)/interviews/[interviewId]/room/page.tsx' lib/interview/agent/room-state.test.ts
git commit -m "feat(interview): hydrate durable agent streams"
```

Expected: test and typecheck PASS.

### Task 5: Direct latest-runtime cutover

**Files:**
- Delete: `lib/interview/agent/feature.ts`
- Delete: `lib/interview/agent/feature.test.ts`
- Modify: `app/api/interviews/route.ts`
- Modify: `app/api/interviews/[id]/messages/route.ts`
- Modify: `app/api/interviews/[id]/runs/[runId]/events/route.ts`
- Modify: `app/api/interviews/[id]/runs/[runId]/route.ts`
- Modify: `app/api/interviews/[id]/runs/[runId]/resume/route.ts`
- Modify: `app/api/interviews/[id]/end/route.ts`
- Modify: `lib/interview/agent/service.ts`
- Create: `scripts/agent-runtime-cutover.ts`
- Create: `scripts/agent-runtime-cutover.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: idempotent `reconcileAgentRuntimeCutover(store, executeRun)` plus a Drizzle `AgentRuntimeCutoverStore` adapter.
- Removes: `INTERVIEW_AGENT_V2_ENABLED` runtime behavior.

- [ ] **Step 1: Write failing cutover tests**

```ts
type CutoverRun = {
  id: string;
  assistantMessage: boolean;
  leaseGeneration: number;
  streamMode: string | null;
  checkpoint: unknown;
};

function runningRun(overrides: Partial<CutoverRun> & Pick<CutoverRun, "id">): CutoverRun {
  return {
    id: overrides.id,
    assistantMessage: overrides.assistantMessage ?? false,
    leaseGeneration: overrides.leaseGeneration ?? 0,
    streamMode: overrides.streamMode ?? null,
    checkpoint: overrides.checkpoint ?? { phase: "reasoning" },
  };
}

function cutoverFixture(initial: CutoverRun[], missingOpeningRuns: string[] = []) {
  const rows = new Map(initial.map((run) => [run.id, structuredClone(run)]));
  const executedRuns: string[] = [];
  let pendingOpeningRuns = [...missingOpeningRuns];
  const store: AgentRuntimeCutoverStore = {
    async prepareMissingOpeningRuns() {
      const created = pendingOpeningRuns;
      pendingOpeningRuns = [];
      return created;
    },
    async listCandidateRunIds() { return [...rows.keys()]; },
    async reconcileRun(runId) {
      const run = rows.get(runId)!;
      if (run.streamMode === "durable_provisional") return "skipped";
      run.streamMode = "durable_provisional";
      run.leaseGeneration += 1;
      run.checkpoint = null;
      return run.assistantMessage ? "completed" : "resume";
    },
  };
  return {
    store,
    executeRun: async (runId: string) => { executedRuns.push(runId); },
    executedRuns,
    run: (runId: string) => rows.get(runId)!,
  };
}

test("fences unfinished runs and resumes only uncommitted work", async () => {
  const fixture = cutoverFixture([
    runningRun({ id: "committed", assistantMessage: true, leaseGeneration: 2 }),
    runningRun({ id: "unfinished", assistantMessage: false, leaseGeneration: 4 }),
  ]);
  const result = await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun);
  assert.deepEqual(result, { completed: ["committed"], resumed: ["unfinished"] });
  assert.equal(fixture.run("unfinished").leaseGeneration, 5);
  assert.equal(fixture.run("unfinished").checkpoint, null);
  assert.deepEqual(fixture.executedRuns, ["unfinished"]);
});

test("starts the latest opening loop for an active interview without a run", async () => {
  const fixture = cutoverFixture([], ["opening-run"]);
  assert.deepEqual(await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun), {
    completed: [],
    resumed: ["opening-run"],
  });
  assert.deepEqual(fixture.executedRuns, ["opening-run"]);
  assert.deepEqual(await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun), {
    completed: [],
    resumed: [],
  });
});

test("is idempotent after the first cutover", async () => {
  const fixture = cutoverFixture([runningRun({ id: "run", assistantMessage: false, streamMode: "durable_provisional" })]);
  await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun);
  assert.deepEqual(await reconcileAgentRuntimeCutover(fixture.store, fixture.executeRun), { completed: [], resumed: [] });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test scripts/agent-runtime-cutover.test.ts
```

Expected: FAIL because the cutover module does not exist.

- [ ] **Step 3: Remove the V2 runtime switch**

Delete `feature.ts` and its test. Remove all `isInterviewAgentEnabled` imports and 404 branches from the listed API routes. In `app/api/interviews/route.ts`, parse every create request with `createAgentInterviewRequestSchema` instead of branching on `rawBody.configVersion`; persist the current config value only as historical provenance, never as an executor switch. Keep authentication, ownership, and interview-state checks unchanged. In `service.ts`, validate active/status semantics rather than rejecting a run solely because `configVersion !== 2`.

- [ ] **Step 4: Implement idempotent cutover reconciliation**

Define the dependency seam exactly as:

```ts
export interface AgentRuntimeCutoverStore {
  prepareMissingOpeningRuns(): Promise<string[]>;
  listCandidateRunIds(): Promise<string[]>;
  reconcileRun(runId: string): Promise<"skipped" | "completed" | "resume">;
}

export async function reconcileAgentRuntimeCutover(
  store: AgentRuntimeCutoverStore,
  executeRun: (runId: string) => Promise<void>,
): Promise<{ completed: string[]; resumed: string[] }>;
```

`reconcileAgentRuntimeCutover` first calls `prepareMissingOpeningRuns`, schedules the returned run IDs, and includes them in `resumed`; it then reconciles existing candidates. The production implementation creates a fenced, idempotent opening run (`cutover:opening:<interviewId>`) plus durable opening trigger for every active interview that lacks an Agent run, using its immutable resume snapshot and existing coverage initialization.

The production Drizzle adapter uses existing `stream_mode` only as a one-time migration marker, never as a runtime branch. Its `reconcileRun` executes this transaction per run:

1. Lock the run and interview.
2. Skip rows already marked `durable_provisional`.
3. Increment `lease_generation` and clear owner/expiry so old workers are fenced.
4. If an assistant message already references the run, mark it completed and append a public terminal event.
5. Otherwise clear provisional checkpoint/authorization fields, increment attempt number, retain durable trigger, set phase `accepted`, and mark `durable_provisional`.
6. After the transaction commits, call the latest `executeClaimedRun` for each unfinished run.

Export a CLI `main()` that creates the Drizzle store from `db` and resumes work with `createProductionAgentDependencies` plus `executeClaimedRun`.

- [ ] **Step 5: Add the operation command**

```json
{
  "scripts": {
    "agent:cutover": "tsx --env-file=.env scripts/agent-runtime-cutover.ts"
  }
}
```

Run order is `pnpm db:migrate`, deploy the latest code, then execute `pnpm agent:cutover` once. A second execution must report zero changed runs.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec tsx --test scripts/agent-runtime-cutover.test.ts lib/interview/agent/service.test.ts
rg -n "INTERVIEW_AGENT_V2_ENABLED|isInterviewAgentEnabled" app lib components || true
npx tsc --noEmit
git add package.json scripts/agent-runtime-cutover.ts scripts/agent-runtime-cutover.test.ts lib/interview/agent/service.ts app/api/interviews
git add -u lib/interview/agent/feature.ts lib/interview/agent/feature.test.ts
git commit -m "refactor(agent): cut over to latest runtime"
```

Expected: tests and typecheck PASS; search prints no matches.

### Task 6: UI and full-system acceptance gate

**Files:**
- Create: `scripts/interview-agent-ui-contract.ts`
- Modify: `scripts/interview-agent-contract.ts`
- Modify: `docs/operations/agent-room-ux-checklist.md`

**Interfaces:**
- Consumes all prior transport, Runtime, and UI work.
- Produces a deterministic protocol acceptance script and final operator checklist.

- [ ] **Step 1: Create the deterministic UI event contract**

The script must fold this exact sequence through `agentRoomReducer`:

```ts
const committedMessage = {
  id: logicalMessageId,
  runId,
  sequence: 2,
  role: "assistant" as const,
  kind: "question" as const,
  content: "请说明自动降级条件？",
};

function publicEvent(sequence: number, type: AgentEventType, payload: unknown): PublicRoomEvent {
  return { runId, sequence, type, payload };
}

const events = [
  publicEvent(1, "reasoning_started", { runId, attemptId: "a1" }),
  publicEvent(2, "reasoning_delta", { runId, attemptId: "a1", entryId: "reasoning:a1", text: "先核对证据。" }),
  publicEvent(3, "proposal_authorized", { runId, attemptId: "a1", logicalMessageId, proposalHash: "a".repeat(64) }),
  publicEvent(4, "response_started", { runId, attemptId: "a1", logicalMessageId }),
  publicEvent(5, "response_delta", { runId, attemptId: "a1", logicalMessageId, text: "请说明自动降级条件？", provisional: true }),
  publicEvent(6, "message_committed", { runId, attemptId: "a1", logicalMessageId, message: committedMessage }),
];
```

Assert reasoning was expanded at event 1, collapsed at event 4, provisional existed at event 5, and only one committed message with no provisional text remains at event 6. Replay events 4–6 and assert state is unchanged.

- [ ] **Step 2: Update the live Agent contract**

Require public event order `reasoning_delta < proposal_authorized < response_started < response_delta < message_committed`, require no legacy `text_delta`, and assert the committed response equals concatenated response deltas.

- [ ] **Step 3: Update the operator UX checklist**

Record these exact checks:

- submit answer appears before reasoning;
- reasoning auto-expands and visibly grows;
- manual collapse is respected during reasoning;
- response start auto-collapses reasoning;
- response grows before database commit;
- reopening reasoning shows revisions and discarded attempts;
- refresh continues from cursor without duplicate text;
- terminal completion creates one scoring job.

- [ ] **Step 4: Run the complete automated gate**

```bash
pnpm exec tsx scripts/interview-agent-ui-contract.ts
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
```

Expected: UI contract prints `Validated live reasoning room protocol.`; all tests PASS; typecheck, lint, and build exit 0.

- [ ] **Step 5: Run optional live provider and PostgreSQL contracts**

```bash
pnpm test:interview:agent
pnpm test:interview:failure
```

Expected with configured credentials: both exit 0. Without credentials, record them as NOT RUN without weakening the local gates.

- [ ] **Step 6: Commit**

```bash
git add scripts/interview-agent-ui-contract.ts scripts/interview-agent-contract.ts docs/operations/agent-room-ux-checklist.md
git commit -m "test(agent): verify live reasoning room"
```
