# Interview Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a feature-flagged, backend-complete interview Agent MVP that opens from resume evidence, accepts continuous candidate messages, asks bounded follow-ups, autonomously finishes, persists every run, and cannot exceed category, round, tool, or loop limits.

**Architecture:** Keep legacy interviews readable and add `configVersion: 2` as an additive path. Each candidate message starts a short-lived bounded run that restores durable state, obtains a structured model step through an injectable port, executes only registered interview-domain tools, records append-only events, and commits exactly one interviewer outcome. Streaming recovery, Prompt Pipe compaction, new room UI, durable scoring jobs, deferred tools, and Skills are separate dependent plans.

**Tech Stack:** TypeScript strict mode, Next.js 16 App Router, React 19, Drizzle ORM, PostgreSQL, Zod 4, Vercel AI SDK 7, Node test runner through `tsx --test`.

## Global Constraints

- Update the full PRD and `AGENTS.md` Core Requirements before changing the interview flow.
- Preserve the six scoring dimensions and existing report/deep-dive behavior.
- New interviews accept only `language`, `persona`, `preference`, and optional `preferenceTags`.
- A question category can contain at most 3 questions, including follow-ups.
- An interview can contain at most 20 candidate-answer rounds.
- A candidate can end the interview at any time.
- The model proposes actions; deterministic code authorizes them.
- The agent receives only interview-domain tools and cannot access shell, filesystem, network, or arbitrary database operations.
- Each agent run allows at most 8 model turns and 12 tool calls.
- Legacy interviews remain readable while `INTERVIEW_AGENT_V2_ENABLED` is disabled or while `configVersion` is 1.
- Do not remove legacy columns or `/next-question` in this plan.

---

## File Structure

### Modified files

| File | Responsibility after this plan |
|---|---|
| `/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md` | Canonical product and Agent-flow rules |
| `AGENTS.md` | Repository-level Core Requirements synchronized with the PRD |
| `lib/interview/settings.ts` | Versioned legacy and v2 interview configuration |
| `lib/db/schema.ts` | Additive Agent persistence tables and v2 interview columns |
| `lib/db/migrate.ts` | Idempotent SQL migration for Agent persistence |
| `lib/interview/schemas.ts` | Re-export or consume Agent decision contracts without changing scoring schemas |
| `lib/ai/model-policy.ts` | Register `interview.agent` as a fast interactive task |
| `app/api/interviews/route.ts` | Feature-flagged v2 interview creation and opening run |
| `package.json` | Include interview Agent tests in `pnpm test` |

### Created files

```text
lib/interview/agent/
  contracts.ts              # enums, Zod schemas, run/tool/result contracts
  limits.ts                 # deterministic interview limit policy
  limits.test.ts
  loop-detector.ts          # repeat, no-progress, ping-pong and global breakers
  loop-detector.test.ts
  tool-registry.ts           # tool definitions and lookup
  tool-pipeline.ts           # validation, hooks, authorization and execution
  tool-pipeline.test.ts
  repository.ts              # durable runs, events, messages and coverage operations
  model-port.ts              # injectable Agent model boundary
  runtime.ts                 # bounded model/tool loop
  runtime.test.ts
  service.ts                 # create/open, answer and user-finish use cases
  service.test.ts
app/api/interviews/[id]/messages/route.ts
app/api/interviews/[id]/end/route.ts
```

---

### Task 1: Update Product Contracts and Versioned Settings

**Files:**
- Modify: `/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md`
- Modify: `AGENTS.md`
- Modify: `lib/interview/settings.ts`
- Create: `lib/interview/settings.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `InterviewConfigV1`, `InterviewConfigV2`, `InterviewConfig`, `interviewConfigV2Schema`, `normalizeInterviewConfig()`.
- Consumes: Existing language and persona values from `lib/interview/settings.ts`.

- [ ] **Step 1: Rewrite the PRD configuration and flow sections**

Replace fixed level/type/question-count requirements in PRD §§4, 6, 7, 10 and 13 with the approved continuous flow. Include the exact limits, opening behavior, user termination, category enum, deterministic authorization, and unchanged scoring model from the design spec.

- [ ] **Step 2: Synchronize `AGENTS.md` Core Requirements**

Replace the old configuration table and fixed-question state machine with:

```text
[Dashboard] -> select resume -> [Setup: language, persona, preference]
-> [Opening: infer role and request introduction]
-> [Agent Interview: answer -> evaluate -> follow-up/new topic]
-> [Complete: user request, sufficient coverage, or hard limit]
-> [Report] -> [Deep Dive]
```

State explicitly that category maximum is 3 and candidate-answer maximum is 20.

- [ ] **Step 3: Write failing configuration tests**

Create `lib/interview/settings.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultInterviewConfig,
  interviewConfigV2Schema,
  normalizeInterviewConfig,
} from "./settings";

test("accepts v2 interview preferences", () => {
  const value = interviewConfigV2Schema.parse({
    configVersion: 2,
    language: "zh",
    persona: "standard",
    preference: "重点深挖最近的项目经历",
    preferenceTags: ["project_deep_dive"],
  });
  assert.equal(value.configVersion, 2);
  assert.equal(value.preference.length > 0, true);
});

test("rejects removed fixed-question fields from v2", () => {
  assert.equal(interviewConfigV2Schema.safeParse({
    configVersion: 2,
    language: "zh",
    persona: "standard",
    preference: "",
    preferenceTags: [],
    questionCount: 10,
  }).success, false);
});

test("normalizes stored v1 and v2 configurations", () => {
  assert.equal(normalizeInterviewConfig(defaultInterviewConfig)?.configVersion, 2);
  assert.equal(normalizeInterviewConfig({
    level: "Mid",
    type: "technical",
    language: "en",
    questionCount: 15,
    persona: "standard",
  })?.configVersion, 1);
});
```

- [ ] **Step 4: Run the test and verify failure**

Run: `pnpm exec tsx --test lib/interview/settings.test.ts`

Expected: FAIL because `interviewConfigV2Schema` and versioned normalization do not exist.

- [ ] **Step 5: Implement versioned settings**

In `lib/interview/settings.ts`, retain legacy constants and add:

```ts
export const interviewPreferenceTagValues = [
  "project_deep_dive",
  "technical_foundations",
  "behavioral_evidence",
] as const;

export const interviewConfigV1Schema = z.object({
  configVersion: z.literal(1).default(1),
  level: z.enum(interviewLevelValues),
  type: z.enum(interviewTypeValues),
  language: z.enum(interviewLanguageValues),
  questionCount: z.number().int().min(5).max(30),
  persona: z.enum(interviewPersonaValues),
});

export const interviewConfigV2Schema = z.object({
  configVersion: z.literal(2),
  language: z.enum(interviewLanguageValues),
  persona: z.enum(interviewPersonaValues),
  preference: z.string().trim().max(1000),
  preferenceTags: z.array(z.enum(interviewPreferenceTagValues)).max(3),
}).strict();

export const interviewConfigSchema = z.union([
  interviewConfigV1Schema,
  interviewConfigV2Schema,
]);

export type InterviewConfigV1 = z.infer<typeof interviewConfigV1Schema>;
export type InterviewConfigV2 = z.infer<typeof interviewConfigV2Schema>;
export type InterviewConfig = z.infer<typeof interviewConfigSchema>;

export const defaultInterviewConfig: InterviewConfigV2 = {
  configVersion: 2,
  language: "zh",
  persona: "standard",
  preference: "",
  preferenceTags: [],
};

export function normalizeInterviewConfig(value: unknown): InterviewConfig | null {
  const v2 = interviewConfigV2Schema.safeParse(value);
  if (v2.success) return v2.data;
  const v1 = interviewConfigV1Schema.safeParse(
    value && typeof value === "object" ? { configVersion: 1, ...value } : value,
  );
  return v1.success ? v1.data : null;
}
```

- [ ] **Step 6: Expand the test script and run tests**

Change `package.json` to:

```json
"test": "tsx --test lib/ai/*.test.ts lib/interview/*.test.ts lib/interview/agent/*.test.ts"
```

Run: `pnpm exec tsx --test lib/interview/settings.test.ts`

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md lib/interview/settings.ts lib/interview/settings.test.ts package.json
git commit -m "docs(interview): define agent interview flow"
```

The canonical PRD is outside this repository, so verify its saved contents separately with `rg -n "20|面试偏好|自主结束" '/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md'`; it is not part of this Git commit.

### Task 2: Add Agent Persistence Schema

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`
- Create: `lib/interview/agent/contracts.ts`

**Interfaces:**
- Produces: `AgentRunStatus`, `AgentExitReason`, `AgentEventType`, `InterviewMessageKind`, Drizzle tables `interviewAgentRuns`, `interviewAgentEvents`, `interviewMessages`, and `interviewCoverage`.
- Consumes: `InterviewConfigV2` from Task 1.

- [ ] **Step 1: Define closed runtime contracts**

Create `lib/interview/agent/contracts.ts` with Zod enums for the nine question categories, seven exit reasons, tool results, coverage records, and model steps. Use these exact decision fields:

```ts
export const questionCategorySchema = z.enum([
  "introduction", "resume_project", "technical_depth", "problem_solving",
  "behavioral", "collaboration", "leadership", "career_motivation", "reflection",
]);

export const agentExitReasonSchema = z.enum([
  "completed", "max_turns", "aborted_streaming", "aborted_tools",
  "hook_stopped", "blocking_limit", "prompt_too_long",
]);

export const agentModelStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tool_call"), callId: z.string().min(1), toolName: z.string().min(1), args: z.unknown() }),
  z.object({ type: z.literal("final"), content: z.string().min(1) }),
]);
```

Also export inferred TypeScript types. Keep scoring contracts in `lib/interview/schemas.ts` unchanged.

- [ ] **Step 2: Add additive Drizzle columns and tables**

Modify `interviews` with nullable/additive `configVersion`, `preference`, `preferenceTags`, `targetRole`, and `candidateRoundCount`. Legacy non-null columns remain untouched in this plan and receive compatibility defaults on v2 inserts.

Add tables with unique constraints:

```text
interview_agent_runs: unique(interview_id, idempotency_key)
interview_agent_events: unique(run_id, sequence)
interview_messages: unique(interview_id, sequence), unique(interview_id, idempotency_key)
interview_coverage: unique(interview_id, category, topic)
```

Use `jsonb` for checkpoint, error, metadata, resume evidence ids, and preference tags. Add indexes for interview/run lookup.

- [ ] **Step 3: Add idempotent SQL migration**

In `lib/db/migrate.ts`, use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, and `CREATE UNIQUE INDEX IF NOT EXISTS`. Set existing interview rows to `config_version = 1` and use a database default of 1. Do not backfill v2 preferences or delete legacy fields.

- [ ] **Step 4: Verify TypeScript and migration SQL**

Run: `npx tsc --noEmit`

Expected: PASS.

Run against a configured development database: `pnpm db:migrate`

Expected: `Database migrated successfully`; running the same command a second time also succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts lib/interview/agent/contracts.ts
git commit -m "feat(interview): add agent persistence schema"
```

### Task 3: Implement Deterministic Interview Limits

**Files:**
- Create: `lib/interview/agent/limits.ts`
- Create: `lib/interview/agent/limits.test.ts`

**Interfaces:**
- Produces: `authorizeInterviewAction(input): InterviewAuthorization`.
- Consumes: `QuestionCategory` and coverage contracts from Task 2.

- [ ] **Step 1: Write failing limit tests**

Cover exactly these cases in `limits.test.ts`: first through third category questions allowed, fourth rejected as `category_limit`; twentieth answered round returns `finish`; explicit user end returns `finish`; duplicate question normalized for case and whitespace returns `duplicate_question`; insufficient resume evidence returns `missing_evidence`; a valid follow-up remains in the original category.

Use this fixture shape:

```ts
const base = {
  candidateRoundCount: 4,
  categoryCounts: { technical_depth: 2 },
  recentQuestions: ["请解释你在 Seconda 中的缓存策略。"],
  requestedUserEnd: false,
  proposal: {
    action: "ask" as const,
    category: "technical_depth" as const,
    intent: "follow_up" as const,
    question: "为什么选择这个缓存策略？",
    resumeEvidenceIds: ["project:seconda"],
  },
};
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/limits.test.ts`

Expected: FAIL because `authorizeInterviewAction` does not exist.

- [ ] **Step 3: Implement the pure policy**

Export constants `MAX_CANDIDATE_ROUNDS = 20` and `MAX_QUESTIONS_PER_CATEGORY = 3`. Return one of:

```ts
type InterviewAuthorization =
  | { allowed: true; action: "ask" }
  | { allowed: true; action: "finish"; reason: "user_requested" | "max_rounds" | "agent_completed" }
  | { allowed: false; reason: "category_limit" | "duplicate_question" | "missing_evidence" | "invalid_action" };
```

Check user termination and maximum rounds before evaluating model proposals. Compare recent normalized question strings without an LLM; semantic similarity is deferred to a later context-quality plan.

- [ ] **Step 4: Run tests**

Run: `pnpm exec tsx --test lib/interview/agent/limits.test.ts`

Expected: all limit tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/interview/agent/limits.ts lib/interview/agent/limits.test.ts
git commit -m "feat(interview): enforce bounded interview policy"
```

### Task 4: Build the Append-Only Repository Boundary

**Files:**
- Create: `lib/interview/agent/repository.ts`
- Create: `lib/interview/agent/repository.test.ts`

**Interfaces:**
- Produces: `InterviewAgentRepository` and `createDrizzleInterviewAgentRepository(db)`.
- Consumes: Drizzle tables from Task 2.

- [ ] **Step 1: Define the repository interface and fake-backed contract tests**

The interface must expose:

```ts
export interface InterviewAgentRepository {
  createRun(input: { interviewId: string; idempotencyKey: string }): Promise<{ id: string; status: "running" }>;
  appendEvent(runId: string, event: { type: AgentEventType; payload: unknown }): Promise<{ sequence: number }>;
  appendMessage(input: { interviewId: string; runId: string; role: "user" | "assistant"; kind: InterviewMessageKind; content: string; idempotencyKey?: string }): Promise<{ id: string; sequence: number }>;
  loadState(interviewId: string): Promise<InterviewAgentState>;
  saveCheckpoint(runId: string, checkpoint: AgentCheckpoint): Promise<void>;
  completeRun(runId: string, exitReason: AgentExitReason): Promise<void>;
  failRun(runId: string, exitReason: AgentExitReason, error: unknown): Promise<void>;
}
```

Contract tests verify monotonic event/message sequences, duplicate idempotency-key reuse, and one terminal transition per run.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/repository.test.ts`

Expected: FAIL because the repository is not implemented.

- [ ] **Step 3: Implement transaction-safe Drizzle operations**

Use database transactions and row locking when allocating the next sequence. On unique idempotency conflict, select and return the existing run or message. `completeRun` and `failRun` update only rows whose status is `running`. Sanitize persisted errors through `sanitizeAIError()`.

- [ ] **Step 4: Run repository tests with a test adapter**

Keep pure repository contract tests runnable without production credentials by providing an in-memory adapter inside the test. Mark the Drizzle integration block conditional on `TEST_DATABASE_URL`, and run it in CI when configured.

Run: `pnpm exec tsx --test lib/interview/agent/repository.test.ts`

Expected: contract tests pass; database integration is skipped only when `TEST_DATABASE_URL` is absent.

- [ ] **Step 5: Commit**

```bash
git add lib/interview/agent/repository.ts lib/interview/agent/repository.test.ts
git commit -m "feat(interview): persist agent runs and events"
```

### Task 5: Implement the Interview Tool Pipeline

**Files:**
- Create: `lib/interview/agent/tool-registry.ts`
- Create: `lib/interview/agent/tool-pipeline.ts`
- Create: `lib/interview/agent/tool-pipeline.test.ts`

**Interfaces:**
- Produces: `InterviewToolDefinition<TInput, TOutput>`, `createInterviewToolRegistry()`, and `executeInterviewTool()`.
- Consumes: repository interface and Agent contracts.

- [ ] **Step 1: Write failing pipeline tests**

Test the exact order:

```text
parse -> normalize -> validateBusiness -> beforeHook -> authorize -> execute -> afterHook -> persist
```

Also test enum rejection, a business error with `retryable: false`, a before-hook stop returning `hook_stopped`, authorization denial before execution, and a thrown executor error sanitized before persistence.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/tool-pipeline.test.ts`

Expected: FAIL because the pipeline does not exist.

- [ ] **Step 3: Implement generic definitions and result types**

Use this boundary:

```ts
export type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
  suggestion?: string;
};

export interface InterviewToolDefinition<TInput, TOutput> {
  name: string;
  inputSchema: z.ZodType<TInput>;
  normalize(input: TInput): TInput;
  validateBusiness(input: TInput, context: InterviewToolContext): Promise<ToolError | null>;
  authorize(input: TInput, context: InterviewToolContext): Promise<boolean>;
  execute(input: TInput, context: InterviewToolContext): Promise<TOutput>;
}
```

Implement typed definitions for the seven approved domain tools. `ask_interview_question` calls `authorizeInterviewAction()` before writing a message. `finish_interview` accepts only a closed completion-reason enum.

- [ ] **Step 4: Implement hooks and event persistence**

`executeInterviewTool()` receives arrays of before and after hooks. Before hooks may continue, replace normalized input, or stop. After hooks may redact/normalize output but cannot execute a second tool. Persist `tool_call_started` before execution and `tool_call_completed` for both success and structured failure.

- [ ] **Step 5: Run tests**

Run: `pnpm exec tsx --test lib/interview/agent/tool-pipeline.test.ts`

Expected: all pipeline and domain-tool tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/tool-registry.ts lib/interview/agent/tool-pipeline.ts lib/interview/agent/tool-pipeline.test.ts
git commit -m "feat(interview): add guarded domain tool pipeline"
```

### Task 6: Add Loop Detection and Three-Level Response

**Files:**
- Create: `lib/interview/agent/loop-detector.ts`
- Create: `lib/interview/agent/loop-detector.test.ts`

**Interfaces:**
- Produces: `AgentLoopDetector.record(call): LoopDecision`.
- Consumes: normalized tool-call and tool-result records from Task 5.

- [ ] **Step 1: Write table-driven failing tests**

Include sequences for `A A A`, `A B A B A B`, identical poll results, changing poll results, unknown tools, calls with different arguments but unchanged progress hash, and a reset after real progress.

Expected decisions are:

```ts
type LoopDecision =
  | { level: "continue" }
  | { level: "warning"; warningNumber: 1 | 2; message: string }
  | { level: "break"; reason: "blocking_limit" | "aborted_tools"; message: string };
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/loop-detector.test.ts`

Expected: FAIL because `AgentLoopDetector` does not exist.

- [ ] **Step 3: Implement stable hashing and detectors**

Canonicalize object keys recursively, omit volatile fields declared by each tool, and hash canonical JSON with Node `createHash("sha256")`. Track at most 30 recent calls. Apply thresholds 3, 5 and 7; break at 12 total calls, 6 calls to one tool, or 4 no-progress calls.

- [ ] **Step 4: Run tests**

Run: `pnpm exec tsx --test lib/interview/agent/loop-detector.test.ts`

Expected: all detector tables pass and changing results do not cause false positives.

- [ ] **Step 5: Commit**

```bash
git add lib/interview/agent/loop-detector.ts lib/interview/agent/loop-detector.test.ts
git commit -m "feat(interview): stop repetitive agent tool loops"
```

### Task 7: Implement the Bounded Agent Runtime

**Files:**
- Create: `lib/interview/agent/model-port.ts`
- Create: `lib/interview/agent/runtime.ts`
- Create: `lib/interview/agent/runtime.test.ts`
- Modify: `lib/ai/model-policy.ts`

**Interfaces:**
- Produces: `InterviewAgentModelPort.nextStep()`, `runInterviewAgent()`.
- Consumes: repository, tool pipeline, registry and loop detector.

- [ ] **Step 1: Write runtime tests against a scripted model port**

Test:

- tool call followed by final output exits `completed`;
- eight model turns without a final outcome exits `max_turns`;
- first and second loop warnings are appended to model context;
- the third loop response exits `blocking_limit`;
- tool hook stop exits `hook_stopped`;
- abort during tool execution exits `aborted_tools`;
- every path saves a checkpoint and terminal run state;
- a final text without a committed ask/finish tool is rejected rather than shown to the candidate.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/runtime.test.ts`

Expected: FAIL because the runtime does not exist.

- [ ] **Step 3: Define the model port**

```ts
export interface InterviewAgentModelPort {
  nextStep(input: {
    runId: string;
    messages: readonly AgentRuntimeMessage[];
    tools: readonly AgentToolDescriptor[];
    signal: AbortSignal;
  }): Promise<AgentModelStep>;
}
```

Implement a production adapter using the existing approved fast-model routing and locally validate every returned `AgentModelStep`. Register `interview.agent` in `lib/ai/model-policy.ts` without changing scoring/report routing.

- [ ] **Step 4: Implement the bounded loop**

Use a `for (let turn = 1; turn <= 8; turn += 1)` loop. Before each model call, check the abort signal and persist a checkpoint. For a tool call, execute through the pipeline, record it in the loop detector, append structured results/warnings to runtime context, and continue. Only `ask_interview_question` or `finish_interview` can produce a candidate-visible terminal outcome.

- [ ] **Step 5: Run runtime and AI regression tests**

Run: `pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/ai/model-policy.test.ts lib/ai/generate-structured.test.ts`

Expected: all tests pass; existing AI routing behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/model-port.ts lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts lib/ai/model-policy.ts lib/ai/model-policy.test.ts
git commit -m "feat(interview): run bounded persistent agent turns"
```

### Task 8: Add Interview Agent Use Cases

**Files:**
- Create: `lib/interview/agent/service.ts`
- Create: `lib/interview/agent/service.test.ts`

**Interfaces:**
- Produces: `createAgentInterview()`, `submitCandidateMessage()`, `endAgentInterview()`.
- Consumes: runtime and repository from Tasks 4-7.

- [ ] **Step 1: Write failing service tests**

Cover:

- creation snapshots the selected resume and starts an opening run;
- an obvious role produces a role-specific introduction request;
- ambiguous roles produce one clarification question;
- duplicate message idempotency keys return the existing run;
- an accepted answer increments `candidateRoundCount` exactly once;
- user end completes without another model call;
- an inactive or legacy interview is rejected by v2 message methods;
- a fourth category question is returned to the model as a structured error and never committed.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/service.test.ts`

Expected: FAIL because service methods do not exist.

- [ ] **Step 3: Implement transaction boundaries**

`createAgentInterview()` creates the v2 interview with compatibility values (`level = "agent"`, `type = "agent"`, `questionCount = 20`), writes the initial coverage rows, creates a run, and invokes the runtime. `submitCandidateMessage()` atomically appends the user message and increments the round count before starting the run. `endAgentInterview()` marks the interview completing, invokes the existing report-completion boundary, and records an assistant closing message.

- [ ] **Step 4: Add the opening instruction**

The opening runtime instruction must require resume evidence, role confidence, and exactly one of:

```text
ask_interview_question(category="introduction", ...)
ask_interview_question(category="career_motivation", intent="verify_evidence", ...)
```

It must not expose hidden reasoning or coverage internals in the candidate-facing message.

- [ ] **Step 5: Run service tests**

Run: `pnpm exec tsx --test lib/interview/agent/service.test.ts`

Expected: all service tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/service.ts lib/interview/agent/service.test.ts
git commit -m "feat(interview): orchestrate agent interview sessions"
```

### Task 9: Wire Feature-Flagged API Routes

**Files:**
- Modify: `app/api/interviews/route.ts`
- Create: `app/api/interviews/[id]/messages/route.ts`
- Create: `app/api/interviews/[id]/end/route.ts`
- Create: `lib/interview/agent/api-contract.test.ts`

**Interfaces:**
- Produces: HTTP creation, candidate-message, and user-end contracts for v2.
- Consumes: Task 8 service methods and existing authentication/session helpers.

- [ ] **Step 1: Write API contract tests**

Test Zod request schemas independently:

```ts
const createV2Schema = z.object({
  resumeVersionId: z.string().uuid(),
  configVersion: z.literal(2),
  language: z.enum(["en", "zh", "es", "de"]),
  persona: z.enum(["friendly", "standard", "stressful"]),
  preference: z.string().trim().max(1000),
  preferenceTags: z.array(z.enum([
    "project_deep_dive", "technical_foundations", "behavioral_evidence",
  ])).max(3),
}).strict();

const candidateMessageSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().uuid(),
}).strict();
```

Verify removed fields are rejected for v2 and legacy input still follows the old branch when the flag is off.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/api-contract.test.ts`

Expected: FAIL because the exported schemas/routes do not exist.

- [ ] **Step 3: Branch interview creation by feature flag and config version**

When `INTERVIEW_AGENT_V2_ENABLED !== "true"`, preserve the current route behavior. When enabled and the request has `configVersion: 2`, authorize the resume, call `createAgentInterview()`, and return:

```json
{
  "interviewId": "uuid",
  "configVersion": 2,
  "runId": "uuid",
  "status": "active"
}
```

- [ ] **Step 4: Implement authenticated message and end routes**

Both routes verify interview ownership through the existing resume/user joins. Message submission returns `202` with `runId` and committed outcome metadata. End returns `200` when newly completed and an idempotent `200` when already completing/completed.

- [ ] **Step 5: Run contract and full unit tests**

Run: `pnpm test`

Expected: all AI, settings and Agent tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/interviews/route.ts 'app/api/interviews/[id]/messages/route.ts' 'app/api/interviews/[id]/end/route.ts' lib/interview/agent/api-contract.test.ts
git commit -m "feat(api): expose agent interview endpoints"
```

### Task 10: Validate the Agent MVP and Document the Next Boundary

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `scripts/interview-agent-contract.ts`

**Interfaces:**
- Produces: repeatable live smoke test and operational feature-flag documentation.
- Consumes: completed API and persistence contracts.

- [ ] **Step 1: Add configuration documentation**

Add `INTERVIEW_AGENT_V2_ENABLED=false` to `.env.example`. Document that this plan exposes backend v2 APIs but retains the legacy room UI until the UI migration plan is executed.

- [ ] **Step 2: Create the live contract script**

The script must create a v2 interview from a supplied test resume id, assert one opening assistant message, submit scripted candidate answers with UUID idempotency keys, assert category counts never exceed 3, and request user completion. It exits nonzero on duplicated messages, missing terminal run states, or count violations.

- [ ] **Step 3: Run the complete validation suite**

Run:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
```

Expected: all commands exit 0.

With a configured development database and model credentials, run:

```bash
pnpm db:migrate
pnpm exec tsx --env-file=.env scripts/interview-agent-contract.ts
```

Expected: migration succeeds twice; the contract script completes an Agent interview and prints the final run id and exit reason.

- [ ] **Step 4: Review rollback behavior**

Set `INTERVIEW_AGENT_V2_ENABLED=false`, create a legacy interview through the existing dashboard request, answer one question, and open its report. Confirm that v2 rows remain stored but no new v2 runs start.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md scripts/interview-agent-contract.ts
git commit -m "docs(interview): add agent MVP operations guide"
```

---

## Dependent Plans After This MVP

Execute these as separate reviewed plans in order:

1. **Resumable Agent Streaming:** event replay API, heartbeats, provider-idle timeout, provisional/committed content boundary, exponential backoff, streaming-to-non-streaming and model fallback.
2. **Prompt Pipe and Context Engineering:** stable versioned prompt prefix, cache epochs, token telemetry, JIT resume evidence, low-frequency checkpoint compaction, three-level Prompt Too Long recovery.
3. **Agent Interview UI:** new setup fields, continuous conversation room, coverage side panel, explicit end action, reconnection states, removal of fixed question-count presentation for v2.
4. **Durable Scoring and Report Integration:** replace best-effort `after()` scoring, wait for terminal scoring jobs, preserve reports and deep dives.
5. **Deferred Tools and Skills:** searchable tool catalog, lazy schema hydration, versioned `SKILL.md` packages, post-compaction reinjection, permission narrowing.

## Rollback Plan

1. Set `INTERVIEW_AGENT_V2_ENABLED=false`; this immediately returns creation traffic to the legacy branch.
2. Keep additive v2 tables and columns intact for diagnosis; do not drop or rewrite Agent events during rollback.
3. Revert the API wiring commit if the flag branch itself is faulty; domain code can remain unreachable.
4. Fix forward with another additive migration if a schema problem is found. Do not remove columns while any v2 interview exists.

## Risk Checkpoints

- After Task 2, verify migration idempotency before runtime work continues.
- After Task 4, verify duplicate idempotency behavior under concurrent requests.
- After Task 6, review detector false positives using the complete table suite.
- After Task 8, inspect opening and completion transcripts for resume fabrication.
- After Task 9, keep the production feature flag off until the live contract passes.
