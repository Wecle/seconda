# Agent Thinking and Message UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render candidate messages before interviewer activity, show safe auto-expanding thinking summaries and committed background-result cards, and present accurate scoring/report progress.

**Architecture:** A pure room-state reducer reconciles optimistic messages, durable messages, provisional deltas, public thinking events, and committed artifacts by stable identity. The server page provides the initial snapshot once, while the client consumes the bounded stream controller from Reliability Plan Task 4. Thinking content comes only from explicit public summaries and committed lifecycle events, never raw provider reasoning.

**Tech Stack:** React 19, Next.js 16 App Router, TypeScript strict, Tailwind CSS v4, shadcn/ui, Server-Sent Events, Node test runner via `tsx`.

## Global Constraints

- Candidate text appears before any thinking indicator for that answer.
- Thinking auto-expands at every new Run, auto-collapses after a committed candidate-visible result, and remains expanded on Run failure.
- Manual expand/collapse is allowed; a new Run resets the panel to automatic mode.
- Never expose raw chain-of-thought, provider reasoning tokens, internal prompts, or hidden tool arguments.
- `背景已保存` and related cards appear only after durable domain commits.
- Provisional output clears on failure and never appears in the committed transcript.
- The report button is disabled during `scoring` and `reporting`.

---

### Task 1: Add Public Thinking and Artifact Event Contracts

**Files:**
- Modify: `lib/interview/agent/contracts.ts`
- Modify: `lib/interview/agent/stream-contracts.test.ts`
- Create: `lib/interview/agent/public-events.ts`
- Create: `lib/interview/agent/public-events.test.ts`

**Interfaces:**
- Adds events `thinking_started`, `thinking_summary`, `artifact_committed`, `scoring_progress`, and `reporting_started`.
- Produces: `PublicThinkingEntry` and `CommittedArtifact` types.
- Produces: `publicEventFromToolCompletion(toolName, output): PublicAgentEvent | null`.

- [ ] **Step 1: Add failing strict event tests**

```ts
test("accepts bounded public thinking without raw reasoning", () => {
  const event = thinkingSummaryPayloadSchema.parse({
    entryId: "assessment:answer-1",
    stage: "assessment",
    summary: "正在判断回答是否包含足够的项目证据。",
  });
  assert.equal("reasoning" in event, false);
});

test("requires stable artifact identity", () => {
  assert.equal(artifactCommittedPayloadSchema.safeParse({
    type: "background_saved",
    title: "背景已保存",
    summary: "已保存回答背景。",
  }).success, false);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/stream-contracts.test.ts lib/interview/agent/public-events.test.ts`  
Expected: FAIL because schemas and event names are missing.

- [ ] **Step 3: Add strict payload schemas**

```ts
export const thinkingSummaryPayloadSchema = z.object({
  entryId: z.string().min(1).max(200),
  stage: z.enum(["assessment", "evidence", "coverage", "planning", "scoring", "reporting"]),
  summary: z.string().min(1).max(500),
}).strict();

export const artifactCommittedPayloadSchema = z.object({
  artifactId: z.string().min(1).max(200),
  type: z.enum(["answer_extracted", "resume_evidence_linked", "background_saved", "coverage_updated", "direction_updated", "scoring_created", "reporting_started"]),
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  details: z.array(z.string().min(1).max(300)).max(10).default([]),
}).strict();
```

- [ ] **Step 4: Implement a whitelist mapper for committed tools**

The mapper receives sanitized committed output only. Unknown tools return `null`. It must never copy arbitrary arguments or provider reasoning into user-visible summaries.

```ts
const artifactMappers: Partial<Record<InterviewToolName, ArtifactMapper>> = {
  update_coverage: mapCoverageArtifact,
  finish_interview: mapCompletionArtifact,
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm exec tsx --test lib/interview/agent/stream-contracts.test.ts lib/interview/agent/public-events.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/contracts.ts lib/interview/agent/stream-contracts.test.ts lib/interview/agent/public-events.ts lib/interview/agent/public-events.test.ts
git commit -m "feat(interview): define public agent progress events"
```

### Task 2: Emit Real Thinking and Committed Artifact Events

**Files:**
- Modify: `lib/interview/agent/composition.ts`
- Modify: `lib/interview/agent/runtime.ts`
- Modify: `lib/interview/agent/tool-pipeline.ts`
- Modify: `lib/interview/completion/worker.ts`
- Modify: `lib/interview/completion/scoring.ts`
- Modify: `lib/interview/agent/runtime.test.ts`
- Modify: `lib/interview/completion/worker.test.ts`

**Interfaces:**
- Consumes: Plan 2 assessment `publicSummary` and Plan 3 Task 1 event schemas.
- Produces persisted public events with stable IDs.

- [ ] **Step 1: Add failing event-order tests**

```ts
test("emits thinking before planning and artifact only after coverage commit", async () => {
  const result = await runAnswerFixture();
  const types = result.events.map((event) => event.type);
  assert.ok(types.indexOf("thinking_started") < types.indexOf("thinking_summary"));
  assert.ok(types.indexOf("tool_call_completed") < types.indexOf("artifact_committed"));
});

test("does not emit an artifact for a failed tool", async () => {
  const result = await runFailedCoverageFixture();
  assert.equal(result.events.some((event) => event.type === "artifact_committed"), false);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/interview/completion/worker.test.ts`  
Expected: FAIL because public events are not emitted.

- [ ] **Step 3: Emit assessment and planning summaries**

After Plan 2 commits an assessment:

```ts
await repository.appendEvent(runId, {
  type: "thinking_summary",
  payload: {
    entryId: `assessment:${assessment.id}`,
    stage: "assessment",
    summary: assessment.publicSummary,
  },
});
```

Emit `thinking_started` once when the Run begins. Do not emit provider `reasoning` fields.

- [ ] **Step 4: Emit artifacts only after successful domain writes**

After `tool_call_completed` with `{ ok: true }`, call Task 1 mapper and append `artifact_committed` if it returns a value. Assessment persistence emits `answer_extracted`, evidence linkage emits `resume_evidence_linked`, and coverage persistence emits `background_saved`/`coverage_updated` with stable assessment-derived IDs.

- [ ] **Step 5: Emit completion progress**

The completion Worker appends scoring progress after each committed score batch and `reporting_started` only after all scores succeed.

- [ ] **Step 6: Run focused and full tests**

Run: `pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/interview/completion/worker.test.ts && pnpm test && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/composition.ts lib/interview/agent/runtime.ts lib/interview/agent/tool-pipeline.ts lib/interview/completion/worker.ts lib/interview/completion/scoring.ts lib/interview/agent/runtime.test.ts lib/interview/completion/worker.test.ts
git commit -m "feat(interview): stream public agent progress"
```

### Task 3: Build a Pure Room-state Reducer

**Files:**
- Create: `lib/interview/agent/room-state.ts`
- Create: `lib/interview/agent/room-state.test.ts`

**Interfaces:**
- Produces: `AgentRoomState`, `AgentRoomAction`, `agentRoomReducer`.
- Consumes: public event types from Task 1.

- [ ] **Step 1: Add failing message-order and panel-state tests**

```ts
test("places optimistic candidate message before thinking", () => {
  let state = initialAgentRoomState();
  state = agentRoomReducer(state, { type: "candidate_submitted", localId: "m1", idempotencyKey: "k1", content: "回答" });
  state = agentRoomReducer(state, { type: "run_accepted", runId: "r1" });
  assert.deepEqual(state.timeline.map((item) => item.kind), ["candidate_message", "thinking"]);
  assert.equal(state.thinking.expanded, true);
});

test("collapses on committed result and remains open on failure", () => {
  const running = reduceFixture([candidateSubmitted, runAccepted]);
  assert.equal(agentRoomReducer(running, messageCommitted).thinking.expanded, false);
  assert.equal(agentRoomReducer(running, runFailed).thinking.expanded, true);
});

test("a new run resets manual panel choice to automatic expanded mode", () => {
  const state = reduceFixture([runAccepted, { type: "thinking_toggled", expanded: false }, { type: "run_accepted", runId: "r2" }]);
  assert.equal(state.thinking.mode, "auto");
  assert.equal(state.thinking.expanded, true);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/room-state.test.ts`  
Expected: FAIL because the reducer module does not exist.

- [ ] **Step 3: Define normalized state**

```ts
export type AgentRoomState = {
  messages: Record<string, RoomMessage>;
  messageOrder: string[];
  provisional: { messageId: string; text: string } | null;
  thinking: { runId: string | null; mode: "auto" | "manual"; expanded: boolean; entries: PublicThinkingEntry[] };
  artifacts: Record<string, CommittedArtifact>;
  artifactOrder: string[];
  connection: "idle" | "connecting" | "open" | "reconnecting" | "manual_retry" | "terminal";
};
```

- [ ] **Step 4: Implement deterministic reconciliation**

`candidate_submitted` appends a local `sending` message. `candidate_committed` replaces its ID and durable sequence without changing its visual position. `thinking_summary` and `artifact_committed` deduplicate by stable ID. `run_failed` clears provisional and leaves thinking expanded. `message_committed` clears provisional and collapses thinking only when mode is `auto`.

- [ ] **Step 5: Run reducer tests**

Run: `pnpm exec tsx --test lib/interview/agent/room-state.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/room-state.ts lib/interview/agent/room-state.test.ts
git commit -m "feat(interview): model agent room timeline state"
```

### Task 4: Correct Submission Ordering and Retry

**Files:**
- Modify: `lib/interview/agent/api-contracts.ts`
- Modify: `lib/interview/agent/service.ts`
- Modify: `lib/interview/agent/service.test.ts`
- Modify: `app/api/interviews/[id]/messages/route.ts`
- Modify: `components/interview/agent-interview-room.tsx`

**Interfaces:**
- Extends message POST response with `{ message: { id, sequence, content }, runId, status }`.
- Consumes: Task 3 reducer.

- [ ] **Step 1: Add failing service response/idempotency tests**

```ts
test("returns the durable candidate message before scheduling thinking", async () => {
  const result = await submitCandidateMessage(fixtureOptions);
  assert.deepEqual(result.message, { id: "message-1", sequence: 2, content: "回答" });
  assert.equal(result.runId, "run-1");
});

test("retry with one idempotency key returns the same message and run", async () => {
  const first = await submitCandidateMessage(fixtureOptions);
  const second = await submitCandidateMessage(fixtureOptions);
  assert.deepEqual(second, first);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/service.test.ts`  
Expected: FAIL because the service currently returns only Run state.

- [ ] **Step 3: Return the accepted durable message from the store/service**

Change `acceptCandidateMessage` to return the durable message or existing message. Schedule the Run only after persistence.

```ts
return {
  runId: existingOrNewRun.id,
  status: "accepted" as const,
  message: accepted.message,
};
```

- [ ] **Step 4: Dispatch optimistic UI before the POST**

```ts
const localId = crypto.randomUUID();
const idempotencyKey = crypto.randomUUID();
dispatch({ type: "candidate_submitted", localId, idempotencyKey, content });
setDraft("");
const response = await submitAnswer({ content, idempotencyKey });
dispatch({ type: "candidate_committed", localId, message: response.message });
dispatch({ type: "run_accepted", runId: response.runId });
```

On HTTP failure, dispatch `candidate_failed`; retry reuses the stored idempotency key.

- [ ] **Step 5: Run service, reducer, and type tests**

Run: `pnpm exec tsx --test lib/interview/agent/service.test.ts lib/interview/agent/room-state.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/api-contracts.ts lib/interview/agent/service.ts lib/interview/agent/service.test.ts 'app/api/interviews/[id]/messages/route.ts' components/interview/agent-interview-room.tsx
git commit -m "fix(interview): render candidate messages before thinking"
```

### Task 5: Build Thinking and Committed-result Components

**Files:**
- Create: `components/interview/agent-thinking-panel.tsx`
- Create: `components/interview/agent-thinking-panel.test.ts`
- Create: `components/interview/agent-artifact-card.tsx`
- Modify: `components/interview/agent-interview-room.tsx`
- Modify: `lib/i18n/dictionaries/zh.ts`
- Modify: `lib/i18n/dictionaries/en.ts`

**Interfaces:**
- Produces: `<AgentThinkingPanel thinking={state.thinking} onToggle={...} />`.
- Produces: `<AgentArtifactCard artifact={artifact} />`.
- Consumes: Task 3 reducer state.

- [ ] **Step 1: Add component rendering fixtures through a pure view-model test**

Create and test `buildThinkingPanelViewModel` next to the component:

```ts
test("shows processing entries and leaves failure expanded", () => {
  const view = buildThinkingPanelViewModel({
    expanded: true,
    entries: [{ entryId: "1", stage: "coverage", summary: "正在更新覆盖度。" }],
    failure: { exitReason: "blocking_limit", userMessage: "本轮处理未能继续。" },
  });
  assert.equal(view.expanded, true);
  assert.match(view.statusLabel, /未能继续/);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test components/interview/agent-thinking-panel.test.ts`  
Expected: FAIL because the component/view-model is missing.

- [ ] **Step 3: Implement the accessible thinking panel**

Use a button with `aria-expanded`, a live status label, stage icons, and a height/opacity transition that respects reduced motion. Display “查看思考过程” when collapsed. Do not label content as raw model reasoning.

- [ ] **Step 4: Implement committed artifact cards**

Cards use stable artifact IDs as React keys, show title and summary, and reveal details via an accessible disclosure. Map artifact types to approved labels including `背景已保存`, `简历证据已关联`, and `当前主题覆盖度已更新`.

- [ ] **Step 5: Integrate timeline rendering**

Render candidate/interviewer messages, thinking panels, provisional content, and artifacts in reducer timeline order. Thinking is below the candidate message that created the Run.

- [ ] **Step 6: Add Chinese and English copy, then test and lint**

Run: `pnpm exec tsx --test components/interview/agent-thinking-panel.test.ts lib/interview/agent/room-state.test.ts && npx tsc --noEmit && pnpm lint`  
Expected: tests/typecheck pass; lint retains at most the two pre-existing warnings.

- [ ] **Step 7: Commit**

```bash
git add components/interview/agent-thinking-panel.tsx components/interview/agent-thinking-panel.test.ts components/interview/agent-artifact-card.tsx components/interview/agent-interview-room.tsx lib/i18n/dictionaries/zh.ts lib/i18n/dictionaries/en.ts
git commit -m "feat(interview): show agent thinking and saved context"
```

### Task 6: Move Initial Room Loading to the Server Boundary

**Files:**
- Create: `lib/interview/room-data.ts`
- Create: `lib/interview/room-data.test.ts`
- Create: `components/interview/legacy-interview-room.tsx`
- Modify: `app/(app)/interviews/[interviewId]/room/page.tsx`
- Modify: `components/interview/agent-interview-room.tsx`

**Interfaces:**
- Produces: `loadInterviewRoomData(userId, interviewId): Promise<InterviewRoomData>`.
- Server page dispatches v1 read-only and v2 Agent clients from persisted `configVersion`.

- [ ] **Step 1: Add failing data-loader tests**

```ts
test("loads one complete Agent room snapshot", async () => {
  const result = await loadInterviewRoomData(fixture.db, "user", "interview");
  assert.equal(result.interview.configVersion, 2);
  assert.deepEqual(result.agentState.messages.map((item) => item.sequence), [1, 2, 3]);
  assert.equal(fixture.interviewQueryCount, 1);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/room-data.test.ts`  
Expected: FAIL because the loader is missing.

- [ ] **Step 3: Extract the authenticated room loader**

Move the ownership join and initial message/Run/coverage/assessment/progress reads from client fetch flow into `loadInterviewRoomData`. Reuse it from the detail API to avoid divergent response shapes.

- [ ] **Step 4: Split the page into server and client boundaries**

The route page becomes an async Server Component:

```tsx
export default async function InterviewRoomPage({ params }: PageProps) {
  const { interviewId } = await params;
  const userId = await requireCurrentUserId();
  const data = await loadInterviewRoomData(db, userId, interviewId);
  return data.interview.configVersion === 2
    ? <AgentInterviewRoom initialData={data} />
    : <LegacyInterviewRoom initialData={data} />;
}
```

Move the current legacy client implementation into `legacy-interview-room.tsx` without behavior changes.

- [ ] **Step 5: Remove initial Agent detail fetch and dedupe later refreshes**

The Agent client initializes directly from props. Add an in-flight promise guard for explicit refreshes after commit/terminal events; do not use a mount-only `useRef` Strict Mode workaround.

- [ ] **Step 6: Run loader tests, typecheck, and build**

Run: `pnpm exec tsx --test lib/interview/room-data.test.ts && npx tsc --noEmit && pnpm build`  
Expected: PASS and the room route builds as dynamic server-rendered.

- [ ] **Step 7: Restore generated `next-env.d.ts` if needed, then commit**

```bash
git add lib/interview/room-data.ts lib/interview/room-data.test.ts components/interview/legacy-interview-room.tsx 'app/(app)/interviews/[interviewId]/room/page.tsx' components/interview/agent-interview-room.tsx
git commit -m "refactor(interview): load room state on the server"
```

### Task 7: Render Scoring and Reporting Progress

**Files:**
- Create: `components/interview/interview-completion-progress.tsx`
- Create: `components/interview/interview-completion-progress.test.ts`
- Modify: `components/interview/agent-interview-room.tsx`
- Modify: `app/(app)/interviews/[interviewId]/report/page.tsx`
- Modify: `lib/i18n/dictionaries/zh.ts`
- Modify: `lib/i18n/dictionaries/en.ts`

**Interfaces:**
- Consumes Plan 2 detail response `{ status, scoringProgress }`.
- Produces completion progress UI and report gating.

- [ ] **Step 1: Add failing view-model tests**

```ts
test("disables report until completed", () => {
  assert.equal(buildCompletionView({ status: "scoring", scored: 2, total: 5 }).reportEnabled, false);
  assert.equal(buildCompletionView({ status: "reporting", scored: 5, total: 5 }).reportEnabled, false);
  assert.equal(buildCompletionView({ status: "completed", scored: 5, total: 5 }).reportEnabled, true);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test components/interview/interview-completion-progress.test.ts`  
Expected: FAIL because the component/view-model is missing.

- [ ] **Step 3: Implement scoring/report progress**

Show `正在评分 2/5`, `正在生成综合报告`, explicit failed state with retry, and enabled report action only for `completed` with report data.

- [ ] **Step 4: Guard the report route**

For `scoring` or `reporting`, render progress instead of an incomplete report. For completion failure, render the sanitized retry state. Never interpret missing scores as zero.

- [ ] **Step 5: Run tests, typecheck, and lint**

Run: `pnpm exec tsx --test components/interview/interview-completion-progress.test.ts && npx tsc --noEmit && pnpm lint`  
Expected: PASS with at most the two pre-existing warnings.

- [ ] **Step 6: Commit**

```bash
git add components/interview/interview-completion-progress.tsx components/interview/interview-completion-progress.test.ts components/interview/agent-interview-room.tsx 'app/(app)/interviews/[interviewId]/report/page.tsx' lib/i18n/dictionaries/zh.ts lib/i18n/dictionaries/en.ts
git commit -m "feat(interview): show scoring and report progress"
```

### Task 8: Browser and Failure UX Verification

**Files:**
- Create: `docs/operations/agent-room-ux-checklist.md`
- Modify: `README.md`

**Interfaces:**
- Consumes all previous plans.
- Produces repeatable manual/browser QA steps.

- [ ] **Step 1: Write the QA checklist with exact scenarios**

Include:

```text
1. Submit an answer and verify the blue candidate bubble renders before thinking.
2. Verify thinking auto-expands, receives public summaries, and auto-collapses after message_committed.
3. Expand the completed thinking panel manually; start another Run and verify auto mode resets.
4. Force blocking_limit; verify provisional question disappears, failure stays expanded, and network requests stop.
5. Force a network disconnect; verify no more than five reconnects and manual retry appears.
6. End the interview; verify scoring progress, reporting progress, then enabled report.
7. Reload during every state and verify durable reconstruction without duplicate cards/messages.
```

- [ ] **Step 2: Run full automated validation**

Run: `pnpm db:migrate && pnpm db:migrate && pnpm test && npx tsc --noEmit && pnpm lint && pnpm build`  
Expected: all pass; lint retains at most the two pre-existing warnings.

- [ ] **Step 3: Run live contracts when configured**

Run: `pnpm test:interview:agent && pnpm test:interview:failure` when `INTERVIEW_AGENT_TEST_RESUME_VERSION_ID` is present.  
Expected: both pass. If absent, record the skip explicitly.

- [ ] **Step 4: Execute browser QA**

Start `pnpm dev`, follow the checklist, inspect the network panel for duplicate initial GETs and post-terminal SSE requests, and capture screenshots for candidate-before-thinking, expanded thinking, saved background, and scoring progress.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/operations/agent-room-ux-checklist.md README.md
git commit -m "docs(interview): document agent room ux verification"
```

## Plan Acceptance Gate

- Candidate messages always precede thinking indicators.
- Thinking automatically expands for each new Run and collapses only after a committed result.
- Manual toggling works, while the next Run resets automatic behavior.
- Failure leaves thinking expanded, removes provisional output, and stops reconnection.
- Every saved-context card corresponds to a durable event and is deduplicated after reload.
- Initial room rendering performs no duplicate client detail GET.
- Scoring/report progress is accurate and the report cannot open early.
- No raw provider reasoning is shown or persisted.
