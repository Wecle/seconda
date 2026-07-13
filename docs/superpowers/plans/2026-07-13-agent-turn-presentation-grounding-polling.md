# Agent Turn Presentation, Grounding, and Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Agent turn display thinking and committed context above its streamed AI response, prevent unsupported factual claims, and replace completion polling with a bounded backoff controller.

**Architecture:** Split the Agent turn into an internal planning phase and an explicit public response phase. Persist public events with `runId` and stable message/artifact identities, then reduce them into per-Run timeline nodes. Validate factual claims before response streaming and share one bounded polling policy between room and report pages.

**Tech Stack:** TypeScript strict, React 19, Next.js 16 App Router, Vercel AI SDK, Zod, Drizzle ORM/PostgreSQL, Tailwind CSS v4, Node test runner through `tsx`.

## Global Constraints

- Public order is `candidate message → thinking/artifacts → response_started → text_delta → message_committed`.
- AI responses stream only after planning, tool work, policy checks, and factual grounding succeed.
- Follow-ups contain 1–3 sentences of evidence-grounded analysis followed by exactly one question.
- No raw chain-of-thought, hidden tool arguments, internal prompts, or unsupported facts reach the browser.
- Completion polling uses 1.5s, 3s, 5s, then 10s intervals and stops after 2 minutes.
- Existing limits remain: maximum 3 questions per category and 20 candidate-answer rounds.

---

### Task 1: Define the Two-phase Public Stream Contract

**Files:**
- Modify: `lib/interview/agent/contracts.ts`
- Modify: `lib/interview/agent/stream-contracts.test.ts`
- Modify: `components/interview/use-agent-run-stream.ts`
- Test: `lib/interview/agent/stream-contracts.test.ts`

**Interfaces:**
- Produces: `responseStartedPayloadSchema`, Run-scoped `textDeltaPayloadSchema`, Run-scoped `messageCommittedPayloadSchema`.
- Consumes: existing `agentEventTypeSchema` and SSE replay.

- [ ] **Step 1: Write failing strict-contract tests**

```ts
test("requires response_started before run-scoped deltas can be correlated", () => {
  assert.deepEqual(responseStartedPayloadSchema.parse({ runId: "run-1", messageId: "message-1" }), {
    runId: "run-1", messageId: "message-1",
  });
  assert.equal(textDeltaPayloadSchema.safeParse({ messageId: "message-1", attemptId: "a", text: "Q", provisional: true }).success, false);
  assert.equal(messageCommittedPayloadSchema.safeParse({ messageId: "message-1", messageSequence: 3 }).success, false);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec tsx --test lib/interview/agent/stream-contracts.test.ts`
Expected: FAIL because `response_started` and Run-scoped fields are absent.

- [ ] **Step 3: Add strict schemas and subscription support**

```ts
export const responseStartedPayloadSchema = z.object({
  runId: z.string().min(1),
  messageId: z.string().min(1),
}).strict();

export const textDeltaPayloadSchema = z.object({
  runId: z.string().min(1),
  messageId: z.string().min(1),
  attemptId: z.string().min(1),
  text: z.string().min(1),
  provisional: z.literal(true),
}).strict();
```

Add `response_started` to `agentEventTypeSchema` and the client public event list. Add `runId` to `messageCommittedPayloadSchema`.

- [ ] **Step 4: Run focused test and typecheck**

Run: `pnpm exec tsx --test lib/interview/agent/stream-contracts.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/interview/agent/contracts.ts lib/interview/agent/stream-contracts.test.ts components/interview/use-agent-run-stream.ts
git commit -m "feat(interview): define response phase events"
```

### Task 2: Separate Planning from Candidate-visible Response Streaming

**Files:**
- Modify: `lib/interview/agent/runtime.ts`
- Modify: `lib/interview/agent/model-port.ts`
- Modify: `lib/interview/agent/composition.ts`
- Modify: `lib/interview/agent/runtime.test.ts`
- Modify: `lib/interview/agent/model-port.test.ts`

**Interfaces:**
- Consumes: Task 1 `response_started`, Run-scoped deltas and commits.
- Produces: runtime guarantee that no `text_delta` precedes `response_started`.

- [ ] **Step 1: Add an event-order regression test**

```ts
test("finishes planning before streaming a candidate-visible response", async () => {
  const events = await runFollowUpFixture();
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("artifact_committed") < types.indexOf("response_started"));
  assert.ok(types.indexOf("response_started") < types.indexOf("text_delta"));
  assert.ok(types.indexOf("text_delta") < types.indexOf("message_committed"));
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/interview/agent/model-port.test.ts`
Expected: FAIL because the current model port streams while choosing a tool.

- [ ] **Step 3: Introduce a response stream port**

```ts
export interface InterviewResponseStreamPort {
  stream(input: {
    runId: string;
    messageId: string;
    responsePlan: GroundedResponsePlan;
    signal: AbortSignal;
    onDelta(delta: { text: string; attemptId: string }): Promise<void>;
  }): Promise<{ content: string }>;
}
```

The planning model returns a validated `GroundedResponsePlan`; only the response port produces candidate-visible prose. Emit `response_started` immediately before calling `stream`, append Run-scoped deltas, persist the final message, then emit the Run-scoped commit.

- [ ] **Step 4: Remove candidate-visible provisional streaming from planning calls**

Planning may stream provider-internal structured output to the server, but it must never call the public `onProvisionalDelta`. Keep retry/fallback and loop-fuse behavior unchanged.

- [ ] **Step 5: Run focused tests, full Agent tests, and typecheck**

Run: `pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/interview/agent/model-port.test.ts && pnpm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/runtime.ts lib/interview/agent/model-port.ts lib/interview/agent/composition.ts lib/interview/agent/runtime.test.ts lib/interview/agent/model-port.test.ts
git commit -m "fix(interview): stream only after agent planning"
```

### Task 3: Enforce Grounded Analysis and a Single Follow-up

**Files:**
- Create: `lib/interview/agent/grounding.ts`
- Create: `lib/interview/agent/grounding.test.ts`
- Modify: `lib/interview/agent/contracts.ts`
- Modify: `lib/interview/agent/tool-registry.ts`
- Modify: `lib/interview/agent/skills/answer-planning.md`
- Modify: `lib/interview/agent/composition.ts`

**Interfaces:**
- Produces: `groundedResponsePlanSchema`, `validateGroundedClaims(plan, evidence): GroundingResult`.
- Consumes: loaded resume evidence and durable candidate messages.

- [ ] **Step 1: Write failing fact-claim and response-shape tests**

```ts
test("rejects an unsupported team-size attribution", () => {
  const result = validateGroundedClaims({
    acknowledgement: "你提到团队有四人。",
    question: "你如何与后端协作？",
    claims: [{ text: "团队有四人", sourceIds: [] }],
  }, fixtureEvidence);
  assert.deepEqual(result, { ok: false, unsupportedClaims: ["团队有四人"] });
});

test("accepts evidence-grounded acknowledgement plus one question", () => {
  assert.equal(groundedResponsePlanSchema.safeParse({
    acknowledgement: "你说明了查询键分层和统一失效策略。",
    question: "回滚失败时你如何保证最终一致性？",
    claims: [{ text: "查询键分层", sourceIds: ["answer:12"] }],
  }).success, true);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/grounding.test.ts`
Expected: FAIL because the grounding module is missing.

- [ ] **Step 3: Implement strict plan and claim validation**

```ts
export const groundedResponsePlanSchema = z.object({
  acknowledgement: z.string().min(1).max(600),
  question: z.string().min(1).max(500).refine(hasExactlyOneQuestion),
  claims: z.array(z.object({
    text: z.string().min(1).max(200),
    sourceIds: z.array(z.string().min(1)).min(1).max(5),
  }).strict()).max(10),
}).strict();
```

Validate every source ID against the loaded resume evidence or durable answer-message catalog. Require source text to support numeric, role, company, project, responsibility, result, duration and technology claims. Return a structured retryable business error listing unsupported claims, never the hidden evidence body.

- [ ] **Step 4: Update skill and tool contract**

Require 1–3 acknowledgement sentences followed by exactly one question. Explicitly instruct the model to turn uncertain facts into questions and forbid “你提到/简历显示” without a claim source.

- [ ] **Step 5: Wire validation before `response_started`**

If validation fails, return the error to the Agent loop for a bounded repair. Do not emit `response_started` or `text_delta` for rejected plans.

- [ ] **Step 6: Run grounding, tool, runtime, and full tests**

Run: `pnpm exec tsx --test lib/interview/agent/grounding.test.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/runtime.test.ts && pnpm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/grounding.ts lib/interview/agent/grounding.test.ts lib/interview/agent/contracts.ts lib/interview/agent/tool-registry.ts lib/interview/agent/skills/answer-planning.md lib/interview/agent/composition.ts
git commit -m "fix(interview): reject unsupported interview claims"
```

### Task 4: Build Per-Run Timeline Nodes

**Files:**
- Modify: `lib/interview/agent/room-state.ts`
- Modify: `lib/interview/agent/room-state.test.ts`
- Modify: `app/api/interviews/[id]/route.ts`
- Modify: `components/interview/agent-interview-room.tsx`
- Modify: `components/interview/agent-thinking-panel.tsx`
- Modify: `components/interview/agent-artifact-card.tsx`

**Interfaces:**
- Produces: `RoomTurn` and ordered `timeline: RoomTimelineItem[]`.
- Consumes: Run-scoped events from Tasks 1–2 and persisted event/message joins.

- [ ] **Step 1: Add failing ordering and hydration tests**

```ts
test("renders thinking and artifacts above their run's assistant message", () => {
  const state = reduceFixture(answerTurnEvents);
  assert.deepEqual(state.timeline.map((item) => item.kind), [
    "candidate_message", "thinking", "artifact", "assistant_message",
  ]);
});

test("keeps two turns isolated after snapshot hydration", () => {
  const state = initialAgentRoomState(snapshot.messages, snapshot.turns);
  assert.equal(state.turns["run-1"].artifacts.length, 1);
  assert.equal(state.turns["run-2"].artifacts.length, 1);
});
```

- [ ] **Step 2: Run reducer test and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/room-state.test.ts`
Expected: FAIL because thinking/artifacts are global.

- [ ] **Step 3: Normalize state by Run**

```ts
export type RoomTurn = {
  runId: string;
  candidateMessageId: string | null;
  assistantMessageId: string | null;
  thinking: ThinkingState;
  artifacts: CommittedArtifact[];
  provisionalText: string;
  responseStarted: boolean;
};
```

Reducers route every public event using `runId`. Ignore a delta unless its turn has `responseStarted` and the message identity matches. `message_committed` upgrades the provisional message in place.

- [ ] **Step 4: Return a reconstructable snapshot from the detail API**

Join messages and public events by `runId`; parse only whitelisted public payload schemas; return `agentState.turns` ordered by candidate/assistant message sequence. Dedupe artifacts by `artifactId`.

- [ ] **Step 5: Render timeline nodes rather than global append-only blocks**

For each turn render its candidate message, thinking panel, artifact cards, then provisional or committed assistant message. Preserve manual disclosure state and auto-collapse at `response_started`.

- [ ] **Step 6: Run reducer tests, typecheck, lint, and build**

Run: `pnpm exec tsx --test lib/interview/agent/room-state.test.ts && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: PASS; lint retains only the two existing warnings.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/room-state.ts lib/interview/agent/room-state.test.ts app/api/interviews/[id]/route.ts components/interview/agent-interview-room.tsx components/interview/agent-thinking-panel.tsx components/interview/agent-artifact-card.tsx
git commit -m "fix(interview): bind agent progress to each turn"
```

### Task 5: Replace Infinite Completion Polling with a Shared Controller

**Files:**
- Create: `lib/interview/completion/polling.ts`
- Create: `lib/interview/completion/polling.test.ts`
- Create: `components/interview/use-completion-polling.ts`
- Modify: `components/interview/agent-interview-room.tsx`
- Modify: `app/(app)/interviews/[interviewId]/report/page.tsx`
- Modify: `components/interview/interview-completion-progress.tsx`

**Interfaces:**
- Produces: `nextCompletionPoll(state, now): PollDecision` and `useCompletionPolling`.
- Consumes: interview status and detail refresh callback.

- [ ] **Step 1: Write failing pure-policy tests**

```ts
test("backs off and stops at terminal, hidden, or two minutes", () => {
  assert.equal(nextCompletionPoll({ attempt: 0, elapsedMs: 0, status: "scoring", visible: true, online: true }), 1_500);
  assert.equal(nextCompletionPoll({ attempt: 3, elapsedMs: 20_000, status: "reporting", visible: true, online: true }), 10_000);
  assert.equal(nextCompletionPoll({ attempt: 1, elapsedMs: 2_000, status: "completed", visible: true, online: true }), null);
  assert.equal(nextCompletionPoll({ attempt: 1, elapsedMs: 2_000, status: "scoring", visible: false, online: true }), "paused");
  assert.equal(nextCompletionPoll({ attempt: 8, elapsedMs: 120_000, status: "scoring", visible: true, online: true }), null);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm exec tsx --test lib/interview/completion/polling.test.ts`
Expected: FAIL because the policy does not exist.

- [ ] **Step 3: Implement pure bounded policy**

```ts
const DELAYS = [1_500, 3_000, 5_000, 10_000] as const;
export function nextCompletionPoll(input: PollState): number | "paused" | null {
  if (["completed", "failed"].includes(input.status) || input.elapsedMs >= 120_000) return null;
  if (!input.visible || !input.online) return "paused";
  return DELAYS[Math.min(input.attempt, DELAYS.length - 1)];
}
```

- [ ] **Step 4: Implement single-flight hook**

Use one `AbortController`, one timer, visibility/online listeners, and an in-flight promise guard. Cleanup aborts both timer and request. Expose `{ timedOut, refreshNow, resume }`.

- [ ] **Step 5: Replace both polling implementations**

Remove the room's `setInterval(1500)` and report page's recursive fixed-delay fetch. Show manual refresh after timeout and recovery only for failed Completion Jobs.

- [ ] **Step 6: Run polling tests, all tests, typecheck, lint, and build**

Run: `pnpm exec tsx --test lib/interview/completion/polling.test.ts && pnpm test && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: PASS; no ongoing detail requests after terminal status.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/completion/polling.ts lib/interview/completion/polling.test.ts components/interview/use-completion-polling.ts components/interview/agent-interview-room.tsx app/(app)/interviews/[interviewId]/report/page.tsx components/interview/interview-completion-progress.tsx
git commit -m "fix(interview): bound completion status polling"
```

### Task 6: End-to-end Regression and Operational Verification

**Files:**
- Modify: `docs/operations/agent-room-ux-checklist.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: repeatable QA and final verified branch.

- [ ] **Step 1: Extend the manual checklist**

Add exact checks for per-turn ordering, `response_started` before the first delta, unsupported team-size rejection, acknowledgement-plus-question wording, bounded completion polling, hidden-tab pause and terminal stop.

- [ ] **Step 2: Run database and automated validation**

Run: `pnpm db:migrate && pnpm db:migrate && pnpm test && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: migrations are idempotent; tests/typecheck/build pass; lint has at most the two existing warnings.

- [ ] **Step 3: Run live contracts when configured**

Run: `test -n "$INTERVIEW_AGENT_TEST_RESUME_VERSION_ID" && pnpm test:interview:agent && pnpm test:interview:failure`
Expected: both pass when configured; otherwise record the explicit skip.

- [ ] **Step 4: Browser QA**

Start `pnpm dev`, submit at least two answers, inspect the timeline and Network panel, then end the interview. Confirm one Run's thinking/artifacts never move below another Run, the first question delta follows `response_started`, no unsupported facts appear, and detail polling stops at terminal or timeout.

- [ ] **Step 5: Restore generated files and commit documentation**

Restore `next-env.d.ts` to its tracked development reference if `next build` changed it, then run `git diff --check`.

```bash
git add docs/operations/agent-room-ux-checklist.md README.md
git commit -m "docs(interview): verify grounded turn lifecycle"
```
