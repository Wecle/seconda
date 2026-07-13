# Interview Agent Terminal Repair Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a failed early `ask_interview_question` or `finish_interview` return to planning tools when planning budget remains, while retaining the independent three-attempt terminal budget.

**Architecture:** Keep the existing `planning` and `terminal` phases and their tool filtering. Move the phase decision for terminal tools from “tool was attempted” to “tool failed”: a failed terminal action returns to `planning` when fewer than 15 planning steps have been used, and stays `terminal` only after planning exhaustion; a successful terminal action still completes immediately.

**Tech Stack:** TypeScript strict mode, Node test runner through `tsx`, Zod tool schemas, existing in-memory interview Agent repository.

## Global Constraints

- Questions must remain based on resume content and must retain deterministic `resumeEvidenceIds` validation.
- Planning budget remains exactly 15 non-terminal tool calls.
- Terminal attempt budget remains exactly 3 calls across `ask_interview_question` and `finish_interview`.
- Failed terminal attempts do not consume planning steps and returning to planning does not refund terminal attempts.
- No database migration, API contract change, scoring change, or interview-flow expansion.
- Preserve the hard maximum of 20 candidate-answer rounds and 3 questions per category.

## File Structure

- Modify `lib/interview/agent/runtime.test.ts`: add a production-sequence regression test that observes the tools offered after a `MISSING_EVIDENCE` terminal failure.
- Modify `lib/interview/agent/runtime.ts`: stop locking terminal phase merely because a terminal tool was attempted; choose the repair phase after a failed terminal result.
- No new runtime abstraction is needed because the transition depends only on existing local counters and constants.

---

### Task 1: Restore Planning Tools After a Failed Early Terminal Action

**Files:**
- Modify: `lib/interview/agent/runtime.test.ts` after `does not count an early terminal action as a planning step`
- Modify: `lib/interview/agent/runtime.ts:206-213,259-268`
- Test: `lib/interview/agent/runtime.test.ts`

**Interfaces:**
- Consumes: `runInterviewAgent(options): Promise<{ exitReason: AgentExitReason; turnCount: number }>` and the existing `InterviewAgentModelPort` input field `tools: Array<{ name: string; description: string }>`.
- Produces: the same runtime API and checkpoint schema; only phase-transition behavior changes.

- [ ] **Step 1: Write the failing production-sequence regression test**

Add this test to `lib/interview/agent/runtime.test.ts`:

```ts
test("restores planning tools after an early terminal action needs evidence repair", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "terminal-repair" });
  const ask = tool("ask_interview_question");
  ask.validateBusiness = async (input) => (
    (input as { resumeEvidenceIds?: string[] }).resumeEvidenceIds?.length
      ? null
      : {
          code: "MISSING_EVIDENCE",
          message: "问题缺少有效的简历证据引用。",
          retryable: false,
          suggestion: "先调用 get_resume_evidence。",
        }
  );
  const steps: AgentModelStep[] = [
    { type: "tool_call", callId: "ask-missing", toolName: "ask_interview_question", args: {} },
    { type: "tool_call", callId: "load-evidence", toolName: "get_resume_evidence", args: { evidenceIds: ["project:3"] } },
    { type: "tool_call", callId: "ask-grounded", toolName: "ask_interview_question", args: { resumeEvidenceIds: ["project:3"] } },
  ];
  const offeredTools: string[][] = [];
  let index = 0;

  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: {
      async nextStep(input) {
        offeredTools.push(input.tools.map(({ name }) => name));
        return steps[index++];
      },
    },
    tools: new Map([
      ["get_resume_evidence", tool("get_resume_evidence")],
      ["ask_interview_question", ask],
      ["finish_interview", tool("finish_interview")],
    ]),
    initialMessages: [{ role: "user", content: "回答" }],
    signal: new AbortController().signal,
    progressHash: () => String(index),
  });

  assert.equal(result.exitReason, "completed");
  assert.equal(result.turnCount, 1);
  assert.ok(offeredTools[1].includes("get_resume_evidence"));
  assert.equal(repository.inspectRun(run.id)?.checkpoint?.terminalAttemptCount, 2);
});
```

- [ ] **Step 2: Run the focused test and verify the current bug**

Run:

```bash
pnpm exec tsx --test --test-name-pattern="restores planning tools" lib/interview/agent/runtime.test.ts
```

Expected: FAIL because the second model call receives terminal-only tools and `get_resume_evidence` is absent; the simulated recovery call is rejected as an unknown tool.

- [ ] **Step 3: Implement the phase transition after the terminal result**

In `lib/interview/agent/runtime.ts`, replace the terminal counter block:

```ts
if (terminal) {
  phase = "terminal";
  terminalAttemptCount += 1;
} else {
  planningStepCount += 1;
}
```

with:

```ts
if (terminal) {
  terminalAttemptCount += 1;
} else {
  planningStepCount += 1;
}
```

Then replace the existing failed-terminal guard:

```ts
if (terminal && !result.ok && terminalAttemptCount >= MAX_TERMINAL_ATTEMPTS) {
  return failRun(
    options,
    "terminal_action_failed",
    new Error("Agent exhausted terminal action attempts"),
    planningStepCount,
  );
}
```

with:

```ts
if (terminal && !result.ok) {
  if (terminalAttemptCount >= MAX_TERMINAL_ATTEMPTS) {
    return failRun(
      options,
      "terminal_action_failed",
      new Error("Agent exhausted terminal action attempts"),
      planningStepCount,
    );
  }
  phase = planningStepCount >= MAX_PLANNING_STEPS ? "terminal" : "planning";
}
```

This keeps successful terminal actions on the existing completion path and makes only failed terminal actions choose a repair phase.

- [ ] **Step 4: Run focused runtime and policy tests**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/interview/agent/runtime-policy.test.ts
```

Expected: all tests PASS, including:

- the new `MISSING_EVIDENCE` repair sequence;
- 15 planning calls followed by terminal-only tools;
- three failed terminal attempts ending in `terminal_action_failed`;
- provider attempts remaining local to each model call.

- [ ] **Step 5: Run TypeScript checking for interface consistency**

Run:

```bash
npx tsc --noEmit
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 6: Review the exact change and commit**

Run:

```bash
git diff --check
git diff -- lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts
git add lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts
git commit -m "fix(interview): allow evidence repair after terminal failure"
```

Expected: one focused commit containing the regression test and minimal state-machine change.

---

### Task 2: Full Regression and Targeted Runtime Verification

**Files:**
- Verify only: no additional source files should change.

**Interfaces:**
- Consumes: the Task 1 runtime behavior and existing project commands.
- Produces: verification evidence that the change preserves the interview Agent, UI, types, lint rules, and production build.

- [ ] **Step 1: Run the full automated test suite**

Run:

```bash
pnpm test
```

Expected: all tests PASS, including the new runtime regression.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm lint
```

Expected: exit code 0. The two pre-existing warnings in `.agents/skills/shadcn-ui/examples/data-table.tsx` and `components/interview/interview-resume-context-sheet.tsx` may remain; no new warning may originate from modified files.

- [ ] **Step 3: Run the strict type check and production build**

Run:

```bash
npx tsc --noEmit
pnpm build
```

Expected: both commands exit 0 and Next.js lists `/interviews/[interviewId]/room` as a dynamic route.

- [ ] **Step 4: Confirm the production failure sequence is now covered**

Run:

```bash
pnpm exec tsx --test --test-name-pattern="restores planning tools" lib/interview/agent/runtime.test.ts
```

Expected: PASS and the test proves `get_resume_evidence` is present immediately after an early `MISSING_EVIDENCE` rejection.

- [ ] **Step 5: Confirm the repository is clean**

Run:

```bash
git status --short
```

Expected: no output. Do not replay or mutate failed run `82b34f90-16e5-465a-967d-60c927096e73`; verify live behavior only through a fresh candidate-answer turn if the user requests an end-to-end mutation test.
