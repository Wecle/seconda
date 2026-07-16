# Public Analysis Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every interview Agent tool call to generate safe public analysis, stream that analysis before the tool lifecycle, and present it as an “analysis process” in the room UI.

**Architecture:** Add a provider-only `publicAnalysis` envelope around the existing business tool schemas. Extract cumulative `publicAnalysis` from tool-input deltas, convert only its newly appended suffix into the existing public reasoning event channel, and strip the field before business validation, authorization, loop detection, and persistence. Reuse the current PostgreSQL/SSE/reducer pipeline and keep provider hidden reasoning ignored.

**Tech Stack:** TypeScript strict mode, Zod 4, Vercel AI SDK 7, Next.js 16 App Router, React 19, Node test runner, PostgreSQL-backed Agent events

## Global Constraints

- Do not expose or persist provider hidden Chain-of-Thought, thinking blocks, or hidden reasoning tokens.
- Do not change the six-dimension scoring model, interview state machine, coverage rules, category limit of 3, global limit of 20 rounds, completion rules, or resume snapshot semantics.
- Do not add a model call, database table, migration, or client request.
- `publicAnalysis` is provider-facing only and must not reach tool handlers, tool commit inputs/results, proposal authorization, `proposalHash`, formal messages, or domain transactions.
- Read-tool analysis uses the configured interview language, is non-empty, and is at most 300 characters.
- Terminal analysis uses the configured interview language, is non-empty, and is at most 1,200 characters.
- Existing public reasoning safety limits remain 2,000 characters per delta and 20,000 characters per attempt.
- `submit_interview_turn.responseText` remains the last generated semantic field.
- Historical runs are replayed without fabricated analysis.

---

### Task 1: Isolate the provider-only public analysis envelope

**Files:**
- Create: `lib/interview/agent/public-analysis.ts`
- Create: `lib/interview/agent/public-analysis.test.ts`

**Interfaces:**
- Consumes: Zod `ZodObject` business schemas and cumulative partial tool input from `parsePartialJson`.
- Produces: `READ_PUBLIC_ANALYSIS_SCHEMA`, `TERMINAL_PUBLIC_ANALYSIS_SCHEMA`, `withPublicAnalysis()`, `readPublicAnalysisDelta()`, and `stripPublicAnalysis()`.

- [ ] **Step 1: Write failing unit tests for envelope creation, cumulative deltas, rewrites, and stripping**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  readPublicAnalysisDelta,
  stripPublicAnalysis,
  withPublicAnalysis,
} from "./public-analysis";

test("adds required public analysis without weakening the business schema", () => {
  const business = z.object({ limit: z.number().int() }).strict();
  const provider = withPublicAnalysis(business, "read");
  assert.equal(provider.safeParse({ publicAnalysis: "先回顾已提交记录。", limit: 5 }).success, true);
  assert.equal(provider.safeParse({ limit: 5 }).success, false);
  assert.equal(provider.safeParse({ publicAnalysis: "先回顾记录。", limit: 5, extra: true }).success, false);
});

test("returns only the suffix of a cumulative public analysis field", () => {
  assert.deepEqual(
    readPublicAnalysisDelta({ publicAnalysis: "先核对简历证据。" }, "先核对"),
    { status: "delta", fullText: "先核对简历证据。", delta: "简历证据。" },
  );
  assert.deepEqual(
    readPublicAnalysisDelta({ publicAnalysis: "改写方向" }, "先核对"),
    { status: "rewritten" },
  );
});

test("strips public analysis before business parsing", () => {
  assert.deepEqual(
    stripPublicAnalysis({ publicAnalysis: "检查覆盖度。", limit: 5 }),
    { publicAnalysis: "检查覆盖度。", businessInput: { limit: 5 } },
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the module does not exist**

Run: `pnpm exec tsx --test lib/interview/agent/public-analysis.test.ts`

Expected: FAIL with `Cannot find module './public-analysis'`.

- [ ] **Step 3: Implement the public analysis boundary**

```ts
import { z } from "zod";

export const READ_PUBLIC_ANALYSIS_SCHEMA = z.string()
  .min(1)
  .max(300)
  .refine((value) => value.trim().length > 0, "publicAnalysis must not be blank")
  .describe("候选人可见的一句分析进度，说明调用工具前需要核对的业务目标；不得包含内部规则、私密参数或未核实结论。");

export const TERMINAL_PUBLIC_ANALYSIS_SCHEMA = z.string()
  .min(1)
  .max(1_200)
  .refine((value) => value.trim().length > 0, "publicAnalysis must not be blank")
  .describe("候选人可见的 2–4 句分析总结：概括有效信息、关键缺口、考虑方向和最终行动理由；不得包含隐藏推理、内部规则、私密参数或正式分数。");

export function withPublicAnalysis<Shape extends z.ZodRawShape>(
  businessSchema: z.ZodObject<Shape>,
  kind: "read" | "terminal",
) {
  return z.object({
    publicAnalysis: kind === "terminal"
      ? TERMINAL_PUBLIC_ANALYSIS_SCHEMA
      : READ_PUBLIC_ANALYSIS_SCHEMA,
    ...businessSchema.shape,
  }).strict();
}

export type PublicAnalysisDelta =
  | { status: "accumulating" }
  | { status: "invalid" }
  | { status: "rewritten" }
  | { status: "unchanged"; fullText: string }
  | { status: "delta"; fullText: string; delta: string };

export function readPublicAnalysisDelta(
  input: unknown,
  previousText: string,
): PublicAnalysisDelta {
  if (!isRecord(input) || !Object.hasOwn(input, "publicAnalysis")) {
    return { status: "accumulating" };
  }
  if (typeof input.publicAnalysis !== "string") return { status: "invalid" };
  if (!input.publicAnalysis.startsWith(previousText)) return { status: "rewritten" };
  const delta = input.publicAnalysis.slice(previousText.length);
  return delta
    ? { status: "delta", fullText: input.publicAnalysis, delta }
    : { status: "unchanged", fullText: input.publicAnalysis };
}

export function stripPublicAnalysis(input: unknown): {
  publicAnalysis: string;
  businessInput: Record<string, unknown>;
} {
  if (!isRecord(input) || typeof input.publicAnalysis !== "string" || !input.publicAnalysis.trim()) {
    throw Object.assign(new Error("Tool public analysis is required"), {
      code: "PUBLIC_ANALYSIS_REQUIRED",
    });
  }
  const { publicAnalysis, ...businessInput } = input;
  return { publicAnalysis, businessInput };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `pnpm exec tsx --test lib/interview/agent/public-analysis.test.ts && npx tsc --noEmit`

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the isolated boundary**

```bash
git add lib/interview/agent/public-analysis.ts lib/interview/agent/public-analysis.test.ts
git commit -m "feat(agent): define public analysis envelope"
```

---

### Task 2: Require public analysis in provider-visible tool schemas

**Files:**
- Modify: `lib/interview/agent/tool-registry.ts`
- Modify: `lib/interview/agent/tool-registry.test.ts`
- Modify: `lib/interview/agent/model-port.ts`
- Modify: `lib/interview/agent/model-port.test.ts`

**Interfaces:**
- Consumes: `withPublicAnalysis()` from Task 1 and existing `interviewToolInputSchemas` business schemas.
- Produces: `providerInterviewToolInputSchemas`, used only by provider schemas and AI SDK tool definitions; `interviewToolInputSchemas` remains the business registry contract.

- [ ] **Step 1: Add failing registry tests proving provider/business separation and field order**

```ts
import { providerInterviewToolInputSchemas } from "./tool-registry";

test("requires provider-only public analysis for every model-visible tool", () => {
  assert.equal(providerInterviewToolInputSchemas.get_coverage_state.safeParse({}).success, false);
  assert.equal(providerInterviewToolInputSchemas.get_coverage_state.safeParse({
    publicAnalysis: "先检查当前能力覆盖情况。",
  }).success, true);
  assert.equal(interviewToolInputSchemas.get_coverage_state.safeParse({}).success, true);
  assert.equal(interviewToolInputSchemas.get_coverage_state.safeParse({
    publicAnalysis: "不能进入业务输入",
  }).success, false);
});

test("keeps public analysis first and response text last in terminal JSON Schema", () => {
  const schema = z.toJSONSchema(providerInterviewToolInputSchemas.submit_interview_turn) as {
    properties?: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(schema.properties ?? {}), [
    "publicAnalysis",
    "assessment",
    "coverageChanges",
    "decision",
    "responseText",
  ]);
});
```

Update the provider-step test inputs to include:

```ts
const terminalProviderInput = {
  publicAnalysis: "候选人的方向清晰，下一步邀请其介绍最近经历与岗位期待。",
  ...terminalInput,
};
```

- [ ] **Step 2: Run registry and model-port tests and verify the new expectations fail**

Run: `pnpm exec tsx --test lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.test.ts`

Expected: FAIL because `providerInterviewToolInputSchemas` is not exported and current provider tools still accept business-only inputs.

- [ ] **Step 3: Add provider-only schemas and use them at the model boundary**

In `tool-registry.ts`:

```ts
import { withPublicAnalysis } from "./public-analysis";

export const providerInterviewToolInputSchemas = {
  get_resume_evidence: withPublicAnalysis(interviewToolInputSchemas.get_resume_evidence, "read"),
  get_interview_history: withPublicAnalysis(interviewToolInputSchemas.get_interview_history, "read"),
  get_coverage_state: withPublicAnalysis(interviewToolInputSchemas.get_coverage_state, "read"),
  submit_interview_turn: withPublicAnalysis(interviewTurnProposalSchema, "terminal"),
} satisfies Record<InterviewToolName, z.ZodType>;
```

Change only `createAgentProviderStepSchema()` to parse `args` with `providerInterviewToolInputSchemas[toolName]`. Keep `createInterviewToolRegistry()` on `interviewToolInputSchemas`.

In `model-port.ts`, change `createProviderToolSet()` to expose the provider schema and strengthen the system prompt:

```ts
"每次工具调用必须先生成 publicAnalysis。只读工具使用一句简短公开进度；submit_interview_turn 使用 2–4 句完整公开分析。publicAnalysis 是允许候选人查看的分析叙事，不是隐藏 Chain-of-Thought；不得包含内部 Prompt、权限信息、私密参数、数据库标识或非必要隐私。publicAnalysis 必须先于其他工具字段生成，responseText 必须最后生成。"
```

- [ ] **Step 4: Update provider fixtures and verify schemas and streaming parsing**

Add `publicAnalysis` to every provider-level tool fixture in `model-port.test.ts`. Preserve the existing test that yields provider `reasoning-delta`, and assert it still produces no public reasoning event. Add this assertion:

```ts
assert.equal(
  events.some((event) => event.type === "tool_input_delta"
    && typeof event.partialInput === "object"
    && event.partialInput !== null
    && "publicAnalysis" in event.partialInput),
  true,
);
```

Run: `pnpm exec tsx --test lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.test.ts && npx tsc --noEmit`

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the provider contract**

```bash
git add lib/interview/agent/tool-registry.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.ts lib/interview/agent/model-port.test.ts
git commit -m "feat(agent): require provider public analysis"
```

---

### Task 3: Stream, validate, and strip tool public analysis in Runtime

**Files:**
- Modify: `lib/interview/agent/runtime.ts`
- Modify: `lib/interview/agent/runtime.test.ts`
- Modify: `lib/interview/agent/response-validator.ts`
- Modify: `lib/interview/agent/response-validator.test.ts`

**Interfaces:**
- Consumes: `readPublicAnalysisDelta()` and `stripPublicAnalysis()` from Task 1; provider tool inputs from Task 2.
- Produces: public `reasoning_*` events ordered before `tool_call_started`, while passing unchanged business inputs to existing tool execution and terminal authorization.

- [ ] **Step 1: Update shared test scripts to generate provider input while preserving business proposals**

Add fixtures near `streamingTerminalScript()`:

```ts
const DEFAULT_READ_ANALYSIS = "先核对执行下一步所需的公开业务信息。";
const DEFAULT_TERMINAL_ANALYSIS =
  "候选人的回答提供了当前方向信息。我会基于已核实内容选择下一步问题，并聚焦仍需补充的关键细节。";

function providerTerminalInput(
  proposal: InterviewTurnProposal,
  publicAnalysis = DEFAULT_TERMINAL_ANALYSIS,
) {
  return { publicAnalysis, ...proposal };
}

type ReadToolScriptOptions = {
  callId: string;
  args?: unknown;
  publicAnalysisChunks?: readonly string[];
  afterStream?: () => never;
};

// In readToolScriptWith(), emit each cumulative value and return the complete envelope.
const publicAnalysisChunks = options.publicAnalysisChunks ?? [DEFAULT_READ_ANALYSIS];
for (const publicAnalysis of publicAnalysisChunks) {
  await input.onStreamEvent({
    type: "tool_input_delta",
    attemptId,
    toolCallId: options.callId,
    toolName: "get_coverage_state",
    inputText: JSON.stringify({ publicAnalysis, ...(options.args ?? {}) }),
    partialInput: { publicAnalysis, ...(options.args ?? {}) },
  });
}
const completeArgs = {
  publicAnalysis: publicAnalysisChunks.at(-1) ?? DEFAULT_READ_ANALYSIS,
  ...(options.args ?? {}),
};
```

Change `streamingTerminalScript()` so its partial input starts with `publicAnalysis`, then proposal prefix, then cumulative `responseText`; return `step.args` as the complete provider input. Change `readToolScript()` and `readToolScriptWith()` to include `publicAnalysis` by default.

- [ ] **Step 2: Add failing Runtime tests for ordering, suffix extraction, and business stripping**

```ts
test("streams cumulative tool public analysis once before the read tool lifecycle", async () => {
  const fixture = await createRuntimeFixture({
    model: scriptedModel([
      readToolScriptWith({
        callId: "coverage-public-analysis",
        publicAnalysisChunks: ["先检查", "先检查能力覆盖度。"],
      }),
      streamingTerminalScript({ proposal: openingProposal() }),
    ]),
  });

  await runInterviewAgent(fixture.runOptions);

  const events = await fixture.publicEvents();
  const reasoning = events.filter((event) => event.type === "reasoning_delta")
    .map((event) => (event.payload as { text: string }).text)
    .join("");
  assert.match(reasoning, /先检查能力覆盖度/);
  assert.equal(reasoning.match(/先检查能力覆盖度/g)?.length, 1);
  assert.ok(
    events.findIndex((event) => event.type === "reasoning_delta")
      < events.findIndex((event) => event.type === "tool_call_started"),
  );
});

test("strips public analysis before tool execution and loop hashing", async () => {
  let receivedInput: unknown;
  const fixture = await createRuntimeFixture({
    handlers: {
      get_coverage_state: async (input) => {
        receivedInput = input;
        return [];
      },
    },
    model: scriptedModel([
      readToolScriptWith({ callId: "strip-analysis" }),
      streamingTerminalScript({ proposal: openingProposal() }),
    ]),
  });
  await runInterviewAgent(fixture.runOptions);
  assert.deepEqual(receivedInput, {});
});
```

Add tests for missing analysis (`PUBLIC_ANALYSIS_REQUIRED`), cumulative rewrite (`PUBLIC_ANALYSIS_REWRITTEN`), sensitive split content (`REASONING_SENSITIVE_CONTENT`), terminal analysis before `proposal_authorized`, and no `publicAnalysis` key in the committed terminal proposal.

Add a response-validator regression that detects a configured-language mismatch without applying question-specific validation:

```ts
test("validates configured language for public analysis", () => {
  assert.deepEqual(validateConfiguredLanguage({
    language: "zh",
    text: "Based on the answer, I will inspect the project evidence before choosing a follow-up.",
    allowedTerms: [],
  }), {
    ok: false,
    code: "LANGUAGE_MISMATCH",
    message: "回复语言与面试配置不一致。",
  });
});
```

- [ ] **Step 3: Run Runtime tests and verify the new tests fail**

Run: `pnpm exec tsx --test lib/interview/agent/runtime.test.ts`

Expected: FAIL because Runtime treats `publicAnalysis` as business input and does not convert tool-input analysis to reasoning events.

- [ ] **Step 4: Track cumulative analysis per tool call**

Extend `AttemptState` and initialization:

```ts
type AttemptState = {
  // existing fields
  observedToolAnalyses: Map<string, string>;
};

observedToolAnalyses: new Map<string, string>(),
```

Add a focused Runtime helper:

```ts
async function handleToolPublicAnalysis(
  attempt: AttemptState,
  toolCallId: string,
  partialInput: unknown,
) {
  const previous = attempt.observedToolAnalyses.get(toolCallId) ?? "";
  const progress = readPublicAnalysisDelta(partialInput, previous);
  if (progress.status === "accumulating" || progress.status === "unchanged") return;
  if (progress.status === "invalid") {
    throw new AttemptFailure("PUBLIC_ANALYSIS_INVALID", "publicAnalysis 必须是非空公开文本。");
  }
  if (progress.status === "rewritten") {
    throw new AttemptFailure("PUBLIC_ANALYSIS_REWRITTEN", "模型改写了已公开的分析前缀。");
  }
  const validation = validatePublicReasoningDelta(
    progress.delta,
    attempt.observedReasoningText,
  );
  if (!validation.ok) throw new AttemptFailure(validation.code, validation.message);
  attempt.observedToolAnalyses.set(toolCallId, progress.fullText);
  attempt.observedReasoningText = validation.text;
  await startReasoningIfNeeded(attempt);
  const safePrefix = attempt.reasoningTail.acceptValidated(validation.text);
  if (safePrefix) await attempt.reasoning.append(safePrefix);
}
```

Extract the existing `reasoning_started` write into `startReasoningIfNeeded()` so ordinary assistant text and structured tool analysis share one path.

```ts
async function startReasoningIfNeeded(attempt: AttemptState) {
  if (attempt.reasoningStarted) return;
  attempt.reasoningStarted = true;
  await appendPublicEvent("reasoning_started", {
    runId: options.runId,
    attemptId: attempt.attemptId,
    entryId: `reasoning:${attempt.attemptId}`,
  }, attempt, `reasoning:${attempt.attemptId}:started`);
}
```

Export the existing language-only portion of response validation from `response-validator.ts` without duplicating marker logic:

```ts
export function validateConfiguredLanguage(input: {
  language: ResponseLanguage;
  text: string;
  allowedTerms: readonly string[];
}): ResponseValidationResult {
  if (hasEnoughLanguageSignal(input.text) && isLanguageMismatch(
    input.language,
    input.text,
    input.allowedTerms,
  )) {
    return invalid("LANGUAGE_MISMATCH", "回复语言与面试配置不一致。");
  }
  return { ok: true };
}
```

Call this helper from the existing `validateResponse()` and from `handleToolPublicAnalysis()` after the public analysis has enough signal. Convert a public-analysis mismatch to `AttemptFailure("PUBLIC_ANALYSIS_INVALID", ...)` so the repair prompt refers to the public field rather than the formal response.

- [ ] **Step 5: Process analysis before terminal progress and delay read-tool lifecycle until execution**

At the beginning of `tool_input_delta` handling, call:

```ts
await handleToolPublicAnalysis(attempt, event.toolCallId, event.partialInput);
```

For terminal progress, remove `publicAnalysis` before `readTurnProposalProgress()`:

```ts
const { businessInput } = stripPublicAnalysisFromPartial(event.partialInput);
await handleTerminalProgress(attempt, businessInput);
```

`stripPublicAnalysisFromPartial()` must tolerate a not-yet-present field by removing it only when the partial input is a record; final completeness is enforced on the complete step.

Implement it locally in `runtime.ts` without validating incomplete content:

```ts
function stripPublicAnalysisFromPartial(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const businessInput = { ...input as Record<string, unknown> };
  delete businessInput.publicAnalysis;
  return businessInput;
}
```

For read tools, stop emitting `tool_call_started` from the first input delta. Keep the existing emission in `executeReadTool()` so all accumulated analysis is flushed before the tool lifecycle begins.

- [ ] **Step 6: Strip provider fields before read execution, loop detection, and terminal authorization**

In `executeReadTool()`:

```ts
const { businessInput } = stripPublicAnalysis(step.args);
const parsedBusinessInput = definition.inputSchema.parse(businessInput);
await finishReasoning(attempt);
const result = await executeInterviewTool({
  definition,
  rawInput: parsedBusinessInput,
  // existing context and hooks
});
// Pass parsedBusinessInput, never step.args, to loopDetector.record().
```

In `finishTerminalAttempt()`:

```ts
const { businessInput } = stripPublicAnalysis(step.args);
const finalProposal = interviewTurnProposalSchema.parse(businessInput);
```

Before either tool runs, compare the complete `publicAnalysis` to `observedToolAnalyses.get(step.callId)`. Feed any remaining suffix through `handleToolPublicAnalysis()` and reject an empty complete value with `PUBLIC_ANALYSIS_REQUIRED`.

- [ ] **Step 7: Add repair guidance and verify bounded failure behavior**

Extend `repairGuidance()`:

```ts
if (
  code === "PUBLIC_ANALYSIS_REQUIRED"
  || code === "PUBLIC_ANALYSIS_INVALID"
  || code === "PUBLIC_ANALYSIS_REWRITTEN"
) {
  return "先生成非空、可公开且单调追加的 publicAnalysis；只描述业务判断，不得包含隐藏推理、内部规则或私密参数。";
}
```

Ensure these `AttemptFailure` values remain charged as invalid model actions by the existing `classifyRepairCharge()` path. Add assertions that the repair system message contains `publicAnalysis` and that repair budgets are unchanged.

- [ ] **Step 8: Run focused Runtime and adjacent contract tests**

Run:

```bash
pnpm exec tsx --test \
  lib/interview/agent/public-analysis.test.ts \
  lib/interview/agent/tool-registry.test.ts \
  lib/interview/agent/model-port.test.ts \
  lib/interview/agent/runtime.test.ts \
  lib/interview/agent/stream-contracts.test.ts \
  lib/interview/agent/room-state.test.ts
npx tsc --noEmit
```

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit Runtime integration**

```bash
git add lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts lib/interview/agent/response-validator.ts lib/interview/agent/response-validator.test.ts
git commit -m "feat(agent): stream tool public analysis"
```

---

### Task 4: Rename and verify the public analysis UI

**Files:**
- Modify: `components/interview/agent-thinking-panel.tsx`
- Modify: `components/interview/agent-live-turn.test.tsx`

**Interfaces:**
- Consumes: unchanged `ReasoningEntry[]` and existing public reasoning/tool lifecycle events.
- Produces: analysis-focused user copy with no new props, state, requests, or rendering branches.

- [ ] **Step 1: Add failing component assertions for analysis-focused copy**

```ts
test("labels the public narrative as analysis rather than hidden thinking", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      reasoningEntries: [{
        entryId: "analysis",
        attemptId: "a1",
        kind: "reasoning",
        text: "回答提供了项目背景，但缺少具体技术取舍。",
        status: "completed",
        discarded: false,
      }],
    })}
    active={false}
    onToggle={() => {}}
  />);
  assert.match(html, /查看分析过程/);
  assert.doesNotMatch(html, /查看思考过程/);
});
```

Update placeholder and failure assertions to expect “分析” terminology.

- [ ] **Step 2: Run the component test and verify it fails on old copy**

Run: `pnpm exec tsx --test components/interview/agent-live-turn.test.tsx`

Expected: FAIL because the component still renders “查看思考过程”.

- [ ] **Step 3: Change only the displayed copy**

In `agent-thinking-panel.tsx`:

```ts
const label = thinking.failed
  ? "本轮分析未能完成"
  : active
    ? "面试官分析中"
    : "查看分析过程";
```

Use these empty states:

```tsx
<p>{active
  ? "正在分析回答内容与简历证据，规划下一步问题。"
  : "本轮没有可公开的分析记录。"}</p>
```

For an empty completed reasoning entry use “此步骤没有可公开的补充分析。” Keep the current accessible button, `aria-expanded`, memoized parent, `content-visibility`, and tool visual treatment unchanged.

- [ ] **Step 4: Run component and reducer tests**

Run: `pnpm exec tsx --test components/interview/agent-live-turn.test.tsx lib/interview/agent/room-state.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the UI terminology**

```bash
git add components/interview/agent-thinking-panel.tsx components/interview/agent-live-turn.test.tsx
git commit -m "feat(interview): present public analysis trace"
```

---

### Task 5: Complete regression, live verification, and delivery review

**Files:**
- Modify only if a verification step exposes a defect in files already listed above.
- Do not update the PRD: sections 7.3 and 13.3 already require this exact public-analysis behavior and hidden-reasoning separation.

**Interfaces:**
- Consumes: provider schema, Runtime public events, PostgreSQL/SSE replay, and the room UI completed in Tasks 1–4.
- Produces: a verified feature with no schema migration and a clean worktree.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
git diff --check main...HEAD
```

Expected:

- all non-conditional tests PASS;
- database-dependent tests may report their existing conditional skips only;
- TypeScript exits 0;
- ESLint has 0 errors and no new warnings;
- production build exits 0;
- diff check has no output.

- [ ] **Step 2: Verify a real local interview Run**

Use the existing authenticated local browser session and submit one answer at:

```text
http://localhost:3000/interviews/8dd2a9c9-b02c-4306-9469-fdbb3697ef1e/room
```

Verify the public event order in PostgreSQL for the new Run:

```text
reasoning_started
reasoning_delta (short tool analysis)
tool_call_started
tool_call_completed
reasoning_delta (terminal summary)
proposal_authorized
reasoning_completed
response_started
response_delta...
message_committed
run_completed
```

Verify the page shows “查看分析过程”, at least one short analysis, at least one complete final summary, and the formal interviewer question. Verify no event contains `system prompt`, database identifiers, credentials, raw tool parameters, or provider hidden reasoning text.

- [ ] **Step 3: Review provider/business separation in the final diff**

Run:

```bash
rg -n "publicAnalysis" lib/interview/agent components/interview
git diff --stat main...HEAD
git status --short
```

Expected:

- `publicAnalysis` appears only in the provider schema, extraction/validation path, prompt, and tests;
- tool handlers, repository domain inputs, proposal hashes, messages, and database schema do not contain the field;
- worktree is clean after any required build-generated file restoration.

- [ ] **Step 4: Request final code review**

Use the `requesting-code-review` skill against `main...HEAD`. The review must explicitly check:

- hidden `reasoning-delta` remains ignored;
- public analysis is mandatory and ordered before tools;
- cumulative deltas cannot duplicate or rewrite already visible text;
- `publicAnalysis` is stripped before business execution and hashing;
- repair and recovery remain bounded and attempt-scoped;
- no scoring or interview-policy behavior changed.

Resolve every correctness issue, rerun its focused test, then rerun `pnpm test` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit verification fixes only if needed**

If review or live verification required code changes:

```bash
git add lib/interview/agent/public-analysis.ts lib/interview/agent/public-analysis.test.ts lib/interview/agent/tool-registry.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.ts lib/interview/agent/model-port.test.ts lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts lib/interview/agent/response-validator.ts lib/interview/agent/response-validator.test.ts components/interview/agent-thinking-panel.tsx components/interview/agent-live-turn.test.tsx
git commit -m "fix(agent): harden public analysis trace"
```

If no files changed, do not create an empty commit.
