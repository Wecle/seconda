# Agent Run and SSE Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee one durable terminal event per Agent Run, eliminate abort-listener leaks, and replace infinite EventSource reconnects with bounded state-aware recovery.

**Architecture:** Terminal status and terminal events are committed by one repository operation. SSE treats the Run row and persisted event log as authoritative, including compatibility delivery for historical terminal Runs. A focused client stream controller owns EventSource lifecycle, checks durable status after errors, and reconnects at most five times.

**Tech Stack:** TypeScript strict, Next.js 16 App Router, React 19, Drizzle ORM, PostgreSQL, Server-Sent Events, Node test runner via `tsx`.

## Global Constraints

- Preserve all seven exit reasons: `completed`, `max_turns`, `aborted_streaming`, `aborted_tools`, `hook_stopped`, `blocking_limit`, `prompt_too_long`.
- A terminal Run causes zero further automatic SSE requests.
- `Last-Event-ID` and `after` are both accepted; the larger cursor wins.
- Network recovery uses full-jitter delays capped at 8 seconds and at most 5 reconnects.
- Provisional text is cleared on terminal failure and never becomes a committed message.
- Do not change interview scoring behavior in this plan.

---

### Task 1: Make Run Termination Transactional

**Files:**
- Modify: `lib/interview/agent/contracts.ts`
- Modify: `lib/interview/agent/repository.ts`
- Modify: `lib/interview/agent/repository.test.ts`
- Modify: `lib/interview/agent/runtime.ts`
- Modify: `lib/interview/agent/worker.ts`

**Interfaces:**
- Produces: `terminalRunPayloadSchema` and `TerminalRunPayload`.
- Produces: `InterviewAgentRepository.terminateRun(runId, input): Promise<{ status: "completed" | "failed"; eventSequence: number; created: boolean }>`.
- Replaces direct runtime calls to `completeRun` and `failRun`; temporary compatibility wrappers may delegate to `terminateRun` until all call sites migrate.

- [ ] **Step 1: Write failing repository tests for exactly one terminal event**

```ts
test("commits one completed terminal event", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const first = await repository.terminateRun(run.id, { exitReason: "completed" });
  const second = await repository.terminateRun(run.id, { exitReason: "completed" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual((await repository.listEvents(run.id, 0)).map((event) => event.type), ["run_completed"]);
});

test("persists run_failed before exposing failed status", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  await repository.terminateRun(run.id, {
    exitReason: "blocking_limit",
    error: new Error("no progress"),
    retryable: false,
    userMessage: "本轮处理未能继续，请重试。",
  });
  const events = await repository.listEvents(run.id, 0);
  assert.equal(events.at(-1)?.type, "run_failed");
  assert.equal((await repository.getRun(run.id))?.status, "failed");
});
```

- [ ] **Step 2: Run the focused test and verify the interface is missing**

Run: `pnpm exec tsx --test lib/interview/agent/repository.test.ts`  
Expected: FAIL because `terminateRun` does not exist.

- [ ] **Step 3: Add the strict terminal payload contract**

```ts
export const terminalRunPayloadSchema = z.object({
  runId: z.string().min(1),
  exitReason: agentExitReasonSchema,
  retryable: z.boolean(),
  userMessage: z.string().min(1).max(500),
}).strict();

export type TerminalRunPayload = z.infer<typeof terminalRunPayloadSchema>;
```

- [ ] **Step 4: Implement one termination method in both repositories**

Use this interface:

```ts
terminateRun(runId: string, input: {
  exitReason: AgentExitReason;
  error?: unknown;
  retryable?: boolean;
  userMessage?: string;
}): Promise<{
  status: "completed" | "failed";
  eventSequence: number;
  created: boolean;
}>;
```

The Drizzle implementation must run in `database.transaction`, acquire the existing per-Run advisory lock, return the existing terminal event when status is already terminal, allocate the next event sequence, insert `run_completed` or `run_failed`, then update the Run status and sanitized error before commit.

```ts
const completed = input.exitReason === "completed";
const type = completed ? "run_completed" : "run_failed";
const payload = terminalRunPayloadSchema.parse({
  runId,
  exitReason: input.exitReason,
  retryable: input.retryable ?? false,
  userMessage: input.userMessage ?? defaultExitMessage(input.exitReason),
});
```

- [ ] **Step 5: Migrate runtime and Worker failure paths**

Replace every terminal call with:

```ts
await options.repository.terminateRun(options.runId, {
  exitReason: reason,
  error,
  retryable: reason === "aborted_streaming",
  userMessage: exitReasonMessage(reason),
});
```

Remove separate `appendEvent({ type: "run_completed" })` calls so the event cannot be duplicated.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm exec tsx --test lib/interview/agent/repository.test.ts lib/interview/agent/runtime.test.ts lib/interview/agent/worker.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/contracts.ts lib/interview/agent/repository.ts lib/interview/agent/repository.test.ts lib/interview/agent/runtime.ts lib/interview/agent/worker.ts
git commit -m "fix(interview): persist agent terminal events atomically"
```

### Task 2: Remove AbortSignal Listener Leaks

**Files:**
- Modify: `lib/interview/agent/sse.ts`
- Modify: `lib/interview/agent/sse.test.ts`

**Interfaces:**
- Produces: exported `abortableWait(delayMs, signal)` for focused testing.
- Consumes: no Task 1 interfaces.

- [ ] **Step 1: Add a failing listener-cleanup test**

```ts
test("removes the abort listener after every normal polling wait", async () => {
  const controller = new AbortController();
  let active = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
    active += 1;
    return add(...args);
  }) as typeof controller.signal.addEventListener;
  controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
    active -= 1;
    return remove(...args);
  }) as typeof controller.signal.removeEventListener;
  for (let index = 0; index < 20; index += 1) await abortableWait(0, controller.signal);
  assert.equal(active, 0);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm exec tsx --test lib/interview/agent/sse.test.ts`  
Expected: FAIL because listeners remain registered or `abortableWait` is not exported.

- [ ] **Step 3: Implement settle-once cleanup**

```ts
export function abortableWait(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const timeout = setTimeout(() => finish(resolve), delayMs);
    const onAbort = () => finish(() => {
      clearTimeout(timeout);
      reject(signal.reason);
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
```

- [ ] **Step 4: Run the test 100 times to detect accumulation**

Run: `for i in {1..100}; do pnpm exec tsx --test lib/interview/agent/sse.test.ts >/dev/null || exit 1; done`  
Expected: exit 0 with no `MaxListenersExceededWarning`.

- [ ] **Step 5: Commit**

```bash
git add lib/interview/agent/sse.ts lib/interview/agent/sse.test.ts
git commit -m "fix(interview): clean up sse abort listeners"
```

### Task 3: Deliver Terminal State for Historical Runs

**Files:**
- Modify: `lib/interview/agent/repository.ts`
- Modify: `lib/interview/agent/sse.ts`
- Modify: `lib/interview/agent/sse.test.ts`
- Create: `app/api/interviews/[id]/runs/[runId]/route.ts`

**Interfaces:**
- Extends: `AgentRunRecord` with `lastEventSequence: number`.
- Produces: authenticated Run status response `{ id, status, exitReason, lastEventSequence }`.

- [ ] **Step 1: Add failing SSE tests for terminal compatibility delivery**

```ts
test("synthesizes run_failed for an old failed run without a terminal event", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  repository.inspectRun(run.id)!.status = "failed";
  repository.inspectRun(run.id)!.exitReason = "blocking_limit";
  const events = [];
  for await (const event of pollAgentEvents({
    repository, runId: run.id, afterSequence: 0,
    signal: new AbortController().signal,
  })) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["run_failed"]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/sse.test.ts`  
Expected: FAIL because the generator returns no event for an old terminal Run.

- [ ] **Step 3: Extend Run records and synthesize delivery**

```ts
if (run.status !== "running") {
  const terminalType = run.status === "completed" ? "run_completed" : "run_failed";
  const alreadyDelivered = events.some((event) => event.type === terminalType);
  if (!alreadyDelivered && cursor >= run.lastEventSequence) {
    yield {
      type: terminalType,
      sequence: run.lastEventSequence + 1,
      payload: terminalPayloadFromRun(run),
    };
  }
  return;
}
```

This is compatibility delivery only; Task 1 ensures all new Runs have persisted terminal events.

- [ ] **Step 4: Add the authenticated status endpoint**

The route must reuse the ownership join used by the events endpoint and return:

```ts
return NextResponse.json({
  id: run.id,
  status: run.status,
  exitReason: run.exitReason,
  lastEventSequence: run.lastEventSequence,
});
```

- [ ] **Step 5: Run tests, typecheck, and route build**

Run: `pnpm exec tsx --test lib/interview/agent/sse.test.ts lib/interview/agent/repository.test.ts && npx tsc --noEmit && pnpm build`  
Expected: PASS; build lists `/api/interviews/[id]/runs/[runId]`.

- [ ] **Step 6: Restore generated `next-env.d.ts` if build changes it, then commit**

```bash
git add lib/interview/agent/repository.ts lib/interview/agent/sse.ts lib/interview/agent/sse.test.ts 'app/api/interviews/[id]/runs/[runId]/route.ts'
git commit -m "fix(interview): recover terminal agent run state"
```

### Task 4: Add a Bounded Client Stream Controller

**Files:**
- Create: `lib/interview/agent/client-stream.ts`
- Create: `lib/interview/agent/client-stream.test.ts`
- Create: `components/interview/use-agent-run-stream.ts`
- Modify: `components/interview/agent-interview-room.tsx`

**Interfaces:**
- Produces: `nextReconnectDelay(attempt, random): number | null`.
- Produces: `useAgentRunStream({ interviewId, run, afterSequence, onEvent, onTerminal })`.
- Consumes: Task 3 Run status endpoint.

- [ ] **Step 1: Add failing reconnect-policy tests**

```ts
test("uses full jitter and stops after five reconnects", () => {
  assert.equal(nextReconnectDelay(0, () => 0.5), 250);
  assert.equal(nextReconnectDelay(1, () => 0.5), 500);
  assert.equal(nextReconnectDelay(4, () => 0.5), 4_000);
  assert.equal(nextReconnectDelay(5, () => 0.5), null);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/client-stream.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure retry policy**

```ts
export function nextReconnectDelay(attempt: number, random = Math.random) {
  if (attempt >= 5) return null;
  const cap = Math.min(8_000, 500 * 2 ** attempt);
  return Math.floor(random() * cap);
}
```

- [ ] **Step 4: Implement the hook with explicit EventSource ownership**

The hook must call `source.close()` inside `onerror`, fetch the Task 3 status endpoint, stop immediately for terminal status, and schedule only one reconnect timer for running status. Cleanup closes the source and timer. It exposes `connectionState: "connecting" | "open" | "reconnecting" | "manual_retry" | "terminal"` and `retry()`.

```ts
source.onerror = async () => {
  source.close();
  const status = await loadRunStatus(interviewId, run.id);
  if (status.status !== "running") return onTerminal(status);
  const delay = nextReconnectDelay(reconnectAttempt.current++);
  if (delay === null) return setConnectionState("manual_retry");
  reconnectTimer.current = window.setTimeout(connect, delay);
};
```

- [ ] **Step 5: Replace direct EventSource use in the room**

Remove the component-owned `useEffect` that creates EventSource. On `run_failed`, clear provisional text, retain the failure reason, and never set a generic reconnect message. Render manual retry only when the controller reaches `manual_retry`.

- [ ] **Step 6: Run focused and full tests**

Run: `pnpm exec tsx --test lib/interview/agent/client-stream.test.ts lib/interview/agent/sse.test.ts && pnpm test && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/client-stream.ts lib/interview/agent/client-stream.test.ts components/interview/use-agent-run-stream.ts components/interview/agent-interview-room.tsx
git commit -m "fix(interview): bound agent stream reconnects"
```

### Task 5: Add Failure-injection Coverage

**Files:**
- Create: `scripts/interview-agent-failure-contract.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `pnpm test:interview:failure` local contract command.
- Consumes: terminal event and status APIs from Tasks 1–4.

- [ ] **Step 1: Add a contract script that checks terminal behavior**

The script must create or receive a test Run, inject each failure reason through an in-process repository fixture, consume its stream to terminal, and assert exactly one terminal event and zero subsequent reconnect decisions.

```ts
for (const exitReason of failureReasons) {
  const result = await runFailureScenario(exitReason);
  assert.equal(result.terminalEvents.length, 1);
  assert.equal(result.terminalEvents[0].type, "run_failed");
  assert.equal(result.nextReconnectDelay, null);
}
```

- [ ] **Step 2: Register the command**

```json
"test:interview:failure": "tsx --env-file=.env scripts/interview-agent-failure-contract.ts"
```

- [ ] **Step 3: Document expected recovery semantics**

README must state that terminal Runs never reconnect, network errors retry five times, and `run_failed` clears provisional output.

- [ ] **Step 4: Run the reliability gate**

Run: `pnpm test:interview:failure && pnpm test && npx tsc --noEmit && pnpm lint && pnpm build`  
Expected: all commands succeed; lint may retain only the two pre-existing warnings.

- [ ] **Step 5: Commit**

```bash
git add scripts/interview-agent-failure-contract.ts package.json README.md
git commit -m "test(interview): cover terminal stream recovery"
```

## Plan Acceptance Gate

- Reproduce the previously failed `blocking_limit` Run shape and observe one `run_failed` event.
- Confirm no repeated `/events?after=0` requests after terminal delivery.
- Run a stream for at least 60 seconds without `MaxListenersExceededWarning`.
- Verify a forced network disconnect reconnects at most five times and preserves committed messages.
