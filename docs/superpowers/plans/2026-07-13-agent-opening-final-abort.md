# Agent Opening and Report Abort Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent opening runs from exhausting model turns on `final` output and prevent normal report request cancellation from becoming an unhandled browser error.

**Architecture:** Production model generation uses a strict tool-call-only output schema while the runtime retains its legacy `final` safety branch. Report loading observes request rejection at the effect boundary and distinguishes expected cancellation from real failures.

**Tech Stack:** TypeScript strict, React 19, Next.js 16 App Router, Vercel AI SDK, Zod, Node test runner.

## Global Constraints

- Preserve the PRD interview flow and formal scoring behavior.
- Questions remain resume-grounded and limited by existing deterministic policy.
- Do not change resume records or add dependencies.

---

### Task 1: Constrain Production Agent Output

**Files:**
- Modify: `lib/interview/agent/contracts.ts`
- Modify: `lib/interview/agent/model-port.ts`
- Test: `lib/interview/agent/model-port.test.ts`
- Test: `lib/interview/agent/runtime.test.ts`

**Interfaces:**
- Consumes: `AgentModelStep` and `runInterviewAgent`.
- Produces: a provider-facing Zod schema accepting only `{ type: "tool_call", callId, toolName, args }`.

- [ ] **Step 1: Add a failing schema regression test**

Assert that the provider schema accepts a tool call and rejects `{ type: "final", content: "..." }`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/model-port.test.ts`

- [ ] **Step 3: Add the strict schema and use it for structured generation**

Keep `agentModelStepSchema` for runtime compatibility. Use the strict schema in `generateStructured`, provider instructions, `createProviderOutput`, and final provider parsing. Update the system prompt to require one domain tool call.

- [ ] **Step 4: Add an opening runtime regression test**

Model a `get_coverage_state` call followed by a valid `ask_interview_question` call and assert `completed`.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm exec tsx --test lib/interview/agent/model-port.test.ts lib/interview/agent/runtime.test.ts`

Commit: `fix(interview): require tool calls for agent turns`

### Task 2: Observe Report Request Cancellation

**Files:**
- Modify: `app/(app)/interviews/[interviewId]/report/page.tsx`
- Create: `lib/interview/completion/request-error.ts`
- Test: `lib/interview/completion/request-error.test.ts`

**Interfaces:**
- Produces: `isAbortError(error: unknown): boolean` for request cleanup handling.

- [ ] **Step 1: Add failing cancellation classification tests**

Cover a DOM `AbortError`, an ordinary `Error`, and a non-error value.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec tsx --test lib/interview/completion/request-error.test.ts`

- [ ] **Step 3: Implement cancellation classification and observe `loadReport`**

Ignore only expected aborts. For other failures, stop loading and set a retryable action message without updating state after cleanup.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm exec tsx --test lib/interview/completion/request-error.test.ts components/interview/use-completion-polling.test.ts`

Commit: `fix(report): handle aborted report requests`

### Task 3: Full Regression Validation

**Files:**
- Modify only if validation identifies a defect within this design.

- [ ] **Step 1: Run full unit tests**

Run: `pnpm test`

- [ ] **Step 2: Run static validation**

Run: `npx tsc --noEmit && pnpm lint`

- [ ] **Step 3: Run production build**

Run: `pnpm build`

- [ ] **Step 4: Verify the worktree and record results**

Run: `git status --short && git log --oneline -5`
