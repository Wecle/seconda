# Agent Tool Argument and Repair Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Agent tools are generated with valid tool-specific arguments and recover from a bounded number of correctable validation failures without exhausting productive turns.

**Architecture:** Tool input schemas become the single source for both execution validation and provider constrained output. Runtime accounting separates productive turns from at most two retryable repair attempts, and all rejected calls become observable durable events.

**Tech Stack:** TypeScript strict, Zod 4, Vercel AI SDK, React/Next.js, Node test runner.

## Global Constraints

- Preserve the PRD maximum of 20 candidate-answer rounds and 3 questions per category.
- Keep the Agent loop globally bounded; do not solve this by an unbounded or larger main fuse.
- Persist only sanitized errors.
- Do not modify resume data or formal scoring.

---

### Task 1: Tool-Specific Provider Schema

**Files:**
- Modify: `lib/interview/agent/tool-registry.ts`
- Modify: `lib/interview/agent/model-port.ts`
- Modify: `lib/interview/agent/contracts.ts`
- Test: `lib/interview/agent/model-port.test.ts`
- Test: `lib/interview/agent/tool-registry.test.ts`

- [ ] Add failing tests proving malformed `ask_interview_question` arguments are rejected and inactive tools are absent.
- [ ] Export the tool input schemas and build a strict discriminated provider schema from active tool names.
- [ ] Use that schema in both streaming and non-streaming generation paths.
- [ ] Run focused model-port and registry tests.
- [ ] Commit as `fix(interview): constrain agent tool arguments`.

### Task 2: Opening Tool Surface and Durable Rejections

**Files:**
- Modify: `lib/interview/agent/skills.ts`
- Modify: `lib/interview/agent/tool-pipeline.ts`
- Test: `lib/interview/agent/skills.test.ts`
- Test: `lib/interview/agent/tool-pipeline.test.ts`

- [ ] Add failing tests for opening tool exclusion and persisted parse/business/authorization failures.
- [ ] Remove interview history from the opening tool surface.
- [ ] Persist sanitized `tool_call_completed` events for every early pipeline rejection.
- [ ] Run focused skills and pipeline tests.
- [ ] Commit as `fix(interview): persist rejected agent tools`.

### Task 3: Bounded Repair Accounting and Opening Regression

**Files:**
- Modify: `lib/interview/agent/runtime.ts`
- Test: `lib/interview/agent/runtime.test.ts`

- [ ] Add failing tests for two non-consuming repairs, the third-error fuse, and a realistic evidence-grounded opening.
- [ ] Track productive turns separately from a two-attempt repair budget while enforcing ten total provider calls.
- [ ] Preserve existing loop-detector and exit-reason behavior.
- [ ] Run focused runtime tests.
- [ ] Commit as `fix(interview): bound tool argument repairs`.

### Task 4: Full Validation and Review

**Files:**
- Modify only for defects within this design.

- [ ] Run `pnpm test`.
- [ ] Run `npx tsc --noEmit` and `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Request read-only code review and address Critical or Important findings.
- [ ] Verify a clean worktree.
