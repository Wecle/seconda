# Interview Agent Budget and Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent interview Agent runs from exhausting a shared step budget, remove Chinese lexical `UNSUPPORTED_FACT` blocking, preserve deterministic source validation, and group room messages by interview turn.

**Architecture:** The runtime becomes a two-phase state machine: up to 15 non-terminal planning tool calls followed by a separately budgeted terminal action with at most two repairs. Prompt context carries source-ready recent messages, tool validation checks source identity rather than natural-language entailment, and the room UI renders explicit turn groups instead of `display: contents` children.

**Tech Stack:** TypeScript strict mode, Node test runner through `tsx --test`, React 19, Next.js 16 App Router, Tailwind CSS v4, Zod, Drizzle ORM.

## Global Constraints

- Read `/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md` before implementation and keep §§7, 8, 10, 11, and 13 unchanged except for the runtime behavior explicitly approved in the design.
- Keep the interview limit at 20 candidate-answer rounds and each question category limit at 3, including follow-ups.
- Keep formal six-dimension scoring exclusively after interview completion.
- Questions remain grounded in the immutable interview resume snapshot; clarification is the only action that may omit resume evidence.
- Planning is limited to 15 non-terminal tool calls; `ask_interview_question` and `finish_interview` do not consume that budget.
- The initial terminal action plus at most two repairs gives a maximum of 3 terminal attempts.
- Provider retries remain locally bounded inside one provider request and do not consume planning or terminal-repair budgets.
- Do not add dependencies, database migrations, authentication, cloud storage, voice, or sharing features.
- Do not expose raw Chain-of-Thought, hidden reasoning, prompts, or internal source IDs to candidates.
- Use Chinese system and developer prompt instructions.

---

## File Structure

- Modify `lib/interview/agent/context/assembler.ts`: include message identity and `answer:<messageId>` source IDs in prompt context.
- Modify `lib/interview/agent/context/assembler.test.ts`: prove source-ready recent messages survive context assembly.
- Modify `lib/interview/agent/skills.ts`: tell the Agent to use injected history and coverage before calling read tools.
- Modify `lib/interview/agent/skills.test.ts`: lock the no-redundant-read instructions.
- Modify `lib/interview/agent/grounding.ts`: retain response schemas and composition only; remove lexical entailment code.
- Modify `lib/interview/agent/grounding.test.ts`: retain structural response tests and remove lexical entailment expectations.
- Modify `lib/interview/agent/tool-registry.ts`: validate claim source identity through a dedicated callback.
- Modify `lib/interview/agent/tool-registry.test.ts`: prove missing claim sources fail while paraphrases are not inspected.
- Modify `lib/interview/agent/composition.ts`: validate claim source IDs against the interview snapshot and user messages without comparing prose.
- Create `lib/interview/agent/runtime-policy.ts`: own phase constants, terminal tool selection, and budget predicates.
- Create `lib/interview/agent/runtime-policy.test.ts`: unit-test the pure budget policy.
- Modify `lib/interview/agent/runtime.ts`: implement planning and terminal phases and remove the cross-run provider-attempt cap.
- Modify `lib/interview/agent/runtime.test.ts`: cover 15 planning steps, 3 terminal attempts, provider retry isolation, and the failing Run sequence.
- Modify `lib/interview/agent/contracts.ts`: add precise exit reasons and checkpoint phase metadata.
- Create `lib/interview/agent/exit-messages.ts`: centralize user-facing messages for every exit reason.
- Create `lib/interview/agent/exit-messages.test.ts`: lock exact Chinese failure messages.
- Modify `lib/interview/agent/repository.ts`: use the centralized exit-message mapping.
- Modify `lib/interview/agent/repository.test.ts`: verify terminal payloads use the precise messages.
- Modify `app/api/interviews/[id]/route.ts`: include `userMessage` in refreshed latest-run state.
- Modify `app/api/interviews/[id]/runs/[runId]/route.ts`: include `userMessage` in reconnect status.
- Modify `app/(app)/interviews/[interviewId]/room/page.tsx`: carry `userMessage` through the page-level API response type.
- Modify `components/interview/use-agent-run-stream.ts`: type the persisted `userMessage`.
- Create `components/interview/interview-room-timeline.ts`: group persisted messages into candidate and assistant-initiated turns.
- Create `components/interview/interview-room-timeline.test.ts`: test message grouping independently of React rendering.
- Modify `components/interview/agent-interview-room.tsx`: render explicit `space-y-7` turn groups with `space-y-3` internal spacing and consistent errors.

---

### Task 1: Make Injected Context Source-Ready

**Files:**
- Modify: `lib/interview/agent/context/assembler.ts:11-34,74-142`
- Test: `lib/interview/agent/context/assembler.test.ts`
- Modify: `lib/interview/agent/skills.ts:17-47`
- Test: `lib/interview/agent/skills.test.ts`

**Interfaces:**
- Consumes: `interviewMessages.id`, `interviewMessages.role`, and the existing eight-message prompt tail.
- Produces: recent messages shaped as `{ id, sequence, role, kind, content, sourceId? }`, where user messages have `sourceId: "answer:<id>"`.

- [ ] **Step 1: Write failing context and Skill tests**

Add a source-ID assertion to `assembler.test.ts`:

```ts
test("exposes stable source ids for recent candidate answers", () => {
  const context = assembleAgentContext({
    ...base,
    recentMessages: [{
      id: "message-1",
      sequence: 5,
      role: "user",
      kind: "answer",
      content: "我负责缓存失效策略。",
      sourceId: "answer:message-1",
    }],
    currentInstruction: "继续",
    runId: "run",
  });
  assert.equal(context.incrementalTail.includes('"id":"message-1"'), true);
  assert.equal(context.incrementalTail.includes('"sourceId":"answer:message-1"'), true);
});
```

Add instruction assertions to `skills.test.ts`:

```ts
test("prefers injected history and coverage over redundant reads", () => {
  const instructions = resolveRunSkills("answer").skills.map((skill) => skill.instructions).join("\n");
  assert.match(instructions, /已注入的最近消息/);
  assert.match(instructions, /已注入的覆盖度/);
  assert.match(instructions, /不得重复调用/);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/context/assembler.test.ts lib/interview/agent/skills.test.ts
```

Expected: FAIL because `recentMessages` does not accept `id`/`sourceId` and the Skill text does not contain the new injected-context rules.

- [ ] **Step 3: Add message identity to context assembly**

Change the `assembleAgentContext` input type to:

```ts
recentMessages: Array<{
  id: string;
  sequence: number;
  role: string;
  kind: string;
  content: string;
  sourceId?: string;
}>;
```

Select `id` in `loadAgentContext` and map the prompt tail:

```ts
database.select({
  id: interviewMessages.id,
  sequence: interviewMessages.sequence,
  role: interviewMessages.role,
  kind: interviewMessages.kind,
  content: interviewMessages.content,
})
```

```ts
recentMessages: messages.reverse()
  .filter((message) => message.sequence > (snapshot?.throughMessageSequence ?? 0))
  .map((message) => ({
    ...message,
    ...(message.role === "user" ? { sourceId: `answer:${message.id}` } : {}),
  })),
```

Update all `assembler.test.ts` message fixtures with stable `id` values.

- [ ] **Step 4: Make Skill reads explicitly conditional**

Replace the relevant Skill instructions with exact rules:

```ts
instructions: "优先使用 Prompt 中已注入的最近消息、answer:消息ID、覆盖度和证据目录；这些数据存在时不得重复调用 get_interview_history 或 get_coverage_state。只有需要证据目录未包含的简历原文细节时才调用 get_resume_evidence，并且只能使用目录中出现的稳定 ID。候选人可见评价和问题中的确定性事实必须逐项写入 claims；无法确认时改成询问句。sourceIds 只能放在 claims 中，绝不能出现在 acknowledgement 或 question。不得补全人数、年限、技术栈、职责或成果。",
```

Keep both read tools registered because compaction and future on-demand loading may omit raw details.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/context/assembler.test.ts lib/interview/agent/skills.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the context change**

```bash
git add lib/interview/agent/context/assembler.ts lib/interview/agent/context/assembler.test.ts lib/interview/agent/skills.ts lib/interview/agent/skills.test.ts
git commit -m "fix(interview): inject source-ready agent context"
```

---

### Task 2: Replace Lexical Fact Blocking with Source Identity Validation

**Files:**
- Modify: `lib/interview/agent/grounding.ts`
- Test: `lib/interview/agent/grounding.test.ts`
- Modify: `lib/interview/agent/tool-registry.ts:78-145`
- Test: `lib/interview/agent/tool-registry.test.ts`
- Modify: `lib/interview/agent/composition.ts:84-117`

**Interfaces:**
- Consumes: `claims[].sourceIds`, resume evidence IDs, `resume:raw`, and IDs of user messages owned by the interview.
- Produces: `validateClaimSourceIds(sourceIds, context): Promise<string[]>`; missing values return `SOURCE_NOT_FOUND`, while prose is never compared lexically.

- [ ] **Step 1: Replace lexical tests with structural and source-identity tests**

Rewrite `grounding.test.ts` to keep response structure only:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { composeCandidateResponse, groundedResponsePlanSchema } from "./grounding";

test("accepts paraphrased acknowledgement with declared sources", () => {
  const plan = groundedResponsePlanSchema.parse({
    acknowledgement: "你说明了缓存键的分层与统一失效思路。",
    question: "回滚失败时你如何保证最终一致性？",
    claims: [{ text: "缓存键采用分层设计", sourceIds: ["answer:12"] }],
  });
  assert.equal(composeCandidateResponse(plan), `${plan.acknowledgement}\n\n${plan.question}`);
});

test("still rejects multiple questions and questions in acknowledgement", () => {
  assert.equal(groundedResponsePlanSchema.safeParse({
    acknowledgement: "回答很好。",
    question: "为什么？怎么做？",
    claims: [],
  }).success, false);
  assert.equal(groundedResponsePlanSchema.safeParse({
    acknowledgement: "你为什么这样做？",
    question: "请说明原因？",
    claims: [{ text: "这样做", sourceIds: ["answer:12"] }],
  }).success, false);
});
```

Add a `tool-registry.test.ts` case whose `validateClaimSourceIds` returns one missing answer ID and assert `SOURCE_NOT_FOUND`; add a second case with the same paraphrased text and an empty missing list and assert validation succeeds.

Use this complete test shape:

```ts
test("validates claim source identity without comparing prose", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "sources" });
  const missingBySource = new Set(["answer:missing"]);
  const registry = createInterviewToolRegistry({
    handlers: Object.fromEntries(interviewToolNames.map((name) => [name, async () => ({})])) as never,
    async validateClaimSourceIds(sourceIds) {
      return sourceIds.filter((sourceId) => missingBySource.has(sourceId));
    },
    async loadActionInput(input) {
      return {
        candidateRoundCount: 1,
        categoryCounts: {},
        recentQuestions: [],
        requestedUserEnd: false,
        proposal: {
          action: input.action,
          category: input.category,
          intent: input.intent,
          question: input.question,
          resumeEvidenceIds: input.resumeEvidenceIds,
        },
      };
    },
  });
  const definition = registry.get("ask_interview_question")!;
  const baseInput = {
    action: "ask" as const,
    category: "technical_depth" as const,
    intent: "follow_up" as const,
    acknowledgement: "你说明了缓存键的分层思路。",
    question: "回滚失败时你如何保证最终一致性？",
    topic: "缓存一致性",
    resumeEvidenceIds: ["project:cache"],
  };
  const context = { interviewId: "interview", runId: run.id, repository };
  const missing = await definition.validateBusiness({
    ...baseInput,
    claims: [{ text: "缓存键采用分层设计", sourceIds: ["answer:missing"] }],
  }, context);
  assert.equal(missing?.code, "SOURCE_NOT_FOUND");
  const paraphrase = await definition.validateBusiness({
    ...baseInput,
    claims: [{ text: "完全不同的同义改写", sourceIds: ["answer:valid"] }],
  }, context);
  assert.equal(paraphrase, null);
});
```

Import `interviewToolNames` in the test alongside the existing registry imports.

- [ ] **Step 2: Run focused tests and verify the new source callback is missing**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/grounding.test.ts lib/interview/agent/tool-registry.test.ts
```

Expected: FAIL because `createInterviewToolRegistry` does not accept `validateClaimSourceIds` and still imports lexical validation through production composition.

- [ ] **Step 3: Remove lexical entailment code**

Reduce `grounding.ts` to the exported schemas, `GroundedResponsePlan`, `hasExactlyOneQuestion`, and:

```ts
export function composeCandidateResponse(
  plan: Pick<GroundedResponsePlan, "acknowledgement" | "question">,
) {
  return [plan.acknowledgement, plan.question].filter(Boolean).join("\n\n");
}
```

Delete `validateGroundedClaims`, canonicalization, token overlap, sensitive-attribution, and question-fact extraction helpers.

- [ ] **Step 4: Add deterministic claim source validation to the registry**

Replace the `validateGroundedResponse` option with:

```ts
validateClaimSourceIds?: (
  sourceIds: readonly string[],
  context: InterviewToolContext,
) => Promise<string[]>;
```

Inside `ask_interview_question` business validation, flatten unique claim source IDs and reject only missing identities:

```ts
const sourceIds = [...new Set(questionInput.claims.flatMap((claim) => claim.sourceIds))];
if (options.validateClaimSourceIds && sourceIds.length > 0) {
  const missing = await options.validateClaimSourceIds(sourceIds, context);
  if (missing.length > 0) {
    return {
      code: "SOURCE_NOT_FOUND",
      message: `引用来源不存在：${missing.join(", ")}`,
      retryable: true,
      suggestion: "只使用 Prompt 或工具结果中返回的简历证据 ID 和 answer:消息ID。",
    };
  }
}
```

Keep the existing `EVIDENCE_NOT_FOUND` validation for `resumeEvidenceIds` and `update_coverage`.

- [ ] **Step 5: Validate source ownership in production composition**

Replace the semantic callback in `composition.ts`:

```ts
async validateClaimSourceIds(sourceIds, context) {
  const [index, answers] = await Promise.all([
    loadInterviewEvidenceIndex(context.interviewId),
    db.select({ id: interviewMessages.id })
      .from(interviewMessages)
      .where(and(
        eq(interviewMessages.interviewId, context.interviewId),
        eq(interviewMessages.role, "user"),
      )),
  ]);
  const valid = new Set([
    ...index.records.map((record) => record.id),
    "resume:raw",
    ...answers.map((answer) => `answer:${answer.id}`),
  ]);
  return sourceIds.filter((sourceId) => !valid.has(sourceId));
},
```

Remove the `validateGroundedClaims` import and keep `composeCandidateResponse`.

- [ ] **Step 6: Run fact and registry tests**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/grounding.test.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/limits.test.ts
```

Expected: all tests PASS; `rg "UNSUPPORTED_FACT|validateGroundedClaims" lib/interview/agent` returns no matches.

- [ ] **Step 7: Commit the source-validation change**

```bash
git add lib/interview/agent/grounding.ts lib/interview/agent/grounding.test.ts lib/interview/agent/tool-registry.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/composition.ts
git commit -m "fix(interview): validate source identity without lexical blocking"
```

---

### Task 3: Split Planning and Terminal Runtime Budgets

**Files:**
- Create: `lib/interview/agent/runtime-policy.ts`
- Create: `lib/interview/agent/runtime-policy.test.ts`
- Modify: `lib/interview/agent/runtime.ts:17-300`
- Modify: `lib/interview/agent/runtime.test.ts`
- Modify: `lib/interview/agent/contracts.ts:22-31,109-116`

**Interfaces:**
- Produces: `MAX_PLANNING_STEPS = 15`, `MAX_TERMINAL_ATTEMPTS = 3`, `MAX_INVALID_MODEL_ACTIONS = 3`, `RuntimePhase`, `isTerminalTool()`, and `toolsForRuntimePhase()`.
- Preserves: `runInterviewAgent(...): Promise<{ exitReason: AgentExitReason; turnCount: number }>` where `turnCount` now means completed non-terminal planning calls.

- [ ] **Step 1: Write pure policy tests**

Create `runtime-policy.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PLANNING_STEPS,
  MAX_TERMINAL_ATTEMPTS,
  isTerminalTool,
  toolsForRuntimePhase,
} from "./runtime-policy";

test("uses fifteen planning calls and three terminal attempts", () => {
  assert.equal(MAX_PLANNING_STEPS, 15);
  assert.equal(MAX_TERMINAL_ATTEMPTS, 3);
});

test("terminal phase exposes only ask and finish", () => {
  const tools = new Map([
    ["get_resume_evidence", 1],
    ["ask_interview_question", 2],
    ["finish_interview", 3],
  ]);
  assert.deepEqual([...toolsForRuntimePhase(tools, "terminal").keys()], [
    "ask_interview_question",
    "finish_interview",
  ]);
  assert.equal(isTerminalTool("ask_interview_question"), true);
  assert.equal(isTerminalTool("get_resume_evidence"), false);
});
```

- [ ] **Step 2: Add failing runtime scenarios**

Replace the eight-turn tests in `runtime.test.ts` with fixtures proving:

```ts
test("enters terminal phase after fifteen planning tools and still asks", async () => {
  const planning = Array.from({ length: 15 }, (_, index) => ({
    type: "tool_call" as const,
    callId: `plan-${index}`,
    toolName: "get_coverage_state",
    args: { index },
  }));
  const { result, modelCalls } = await fixture([
    ...planning,
    { type: "tool_call", callId: "ask", toolName: "ask_interview_question", args: {} },
  ]);
  assert.equal(result.exitReason, "completed");
  assert.equal(result.turnCount, 15);
  assert.equal(modelCalls, 16);
});
```

Use changing arguments and a changing `progressHash` fixture option so loop detection does not intentionally stop this budget test. Add tests that:

- an early successful terminal action leaves `turnCount` unchanged;
- an initial terminal failure plus two repairs allows three total terminal attempts, then returns `terminal_action_failed` without a fourth call;
- three provider attempts inside each logical model call do not create a cross-Run cap;
- an aborted signal remains `aborted_streaming`;
- a non-abort model exception returns `provider_failed`;
- the concrete failed sequence of history, coverage, two evidence reads, and two coverage updates can still reach a terminal question.

Extend the fixture with an explicit progress source:

```ts
async function fixture(
  steps: AgentModelStep[],
  tools = [tool("get_coverage_state"), tool("ask_interview_question"), tool("finish_interview")],
  options: { progressHash?: (modelCalls: number) => string } = {},
) {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  let index = 0;
  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: { async nextStep() { return steps[index++] ?? { type: "final", content: "invalid final" }; } },
    tools: new Map(tools.map((definition) => [definition.name, definition])),
    initialMessages: [{ role: "user", content: "start" }],
    signal: new AbortController().signal,
    progressHash: () => options.progressHash?.(index) ?? "same",
  });
  return { result, repository, run, modelCalls: index };
}
```

Call the 15-step test with `{ progressHash: String }`.

Use a terminal tool that always returns a retryable business error for the repair budget:

```ts
test("allows one terminal action and two repairs", async () => {
  const terminal = tool("ask_interview_question");
  terminal.validateBusiness = async () => ({
    code: "SOURCE_NOT_FOUND",
    message: "missing",
    retryable: true,
  });
  const { result, modelCalls } = await fixture(Array.from({ length: 4 }, (_, index) => ({
    type: "tool_call" as const,
    callId: `terminal-${index}`,
    toolName: "ask_interview_question",
    args: {},
  })), [terminal]);
  assert.equal(result.exitReason, "terminal_action_failed");
  assert.equal(result.turnCount, 0);
  assert.equal(modelCalls, 3);
});
```

Replace the old cross-Run provider-cap assertion with a streaming model that calls `onAttemptStarted` three times for each of four logical planning calls, then returns a successful terminal tool on the fifth call. Assert 13 provider attempts are persisted, the Run completes, and `turnCount === 4`.

- [ ] **Step 3: Run policy and runtime tests and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/runtime-policy.test.ts lib/interview/agent/runtime.test.ts
```

Expected: FAIL because the policy module and new exit reasons do not exist and the runtime still caps the whole Run at eight productive turns/ten provider attempts.

- [ ] **Step 4: Create the pure runtime policy**

Create `runtime-policy.ts`:

```ts
export const MAX_PLANNING_STEPS = 15;
export const MAX_TERMINAL_ATTEMPTS = 3;
export const MAX_INVALID_MODEL_ACTIONS = 3;

export type RuntimePhase = "planning" | "terminal";

const TERMINAL_TOOL_NAMES = new Set([
  "ask_interview_question",
  "finish_interview",
]);

export function isTerminalTool(name: string) {
  return TERMINAL_TOOL_NAMES.has(name);
}

export function toolsForRuntimePhase<T>(
  tools: ReadonlyMap<string, T>,
  phase: RuntimePhase,
) {
  return phase === "planning"
    ? new Map(tools)
    : new Map([...tools].filter(([name]) => isTerminalTool(name)));
}
```

- [ ] **Step 5: Extend runtime contracts without breaking historical runs**

Add `provider_failed` and `terminal_action_failed` to `agentExitReasonSchema`. Extend checkpoint phase to include `terminal` while keeping existing values and `turnCount` for persisted checkpoint compatibility:

```ts
phase: z.enum(["assessing", "planning", "terminal", "acting"]).optional(),
terminalAttemptCount: z.number().int().min(0).max(3).optional(),
```

- [ ] **Step 6: Implement the two-phase runtime loop**

Refactor `runInterviewAgent` around these state values:

```ts
let phase: RuntimePhase = "planning";
let planningStepCount = 0;
let terminalAttemptCount = 0;
let invalidModelActionCount = 0;
```

Before every model call, switch phases and filter tools:

```ts
if (planningStepCount >= MAX_PLANNING_STEPS) phase = "terminal";
const availableTools = toolsForRuntimePhase(options.tools, phase);
const modelInput = {
  runId: options.runId,
  messages,
  tools: [...availableTools.keys()].map((name) => ({
    name,
    description: describeTool(name),
  })),
  signal: options.signal,
  promptContext: options.promptContext,
};
```

Remove `MAX_MODEL_TURNS`, `MAX_TOOL_REPAIR_TURNS`, `MAX_PROVIDER_CALLS`, `MAX_PROVIDER_ATTEMPTS`, `REPAIRABLE_TOOL_ERRORS`, `productiveTurnCount`, `repairTurnCount`, and the cross-Run `providerAttemptCount`. Keep `onAttemptStarted` only for persisting attempt metadata.

Apply these exact counting rules:

```ts
const terminal = isTerminalTool(step.toolName);
if (terminal) {
  phase = "terminal";
  terminalAttemptCount += 1;
} else {
  planningStepCount += 1;
}
```

On failed terminal execution, append the tool result for model repair and stop after the third attempt:

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

For `step.type === "final"` and unknown tools, increment `invalidModelActionCount`, feed back one corrective system message, enter terminal phase when the limit is reached, and fail with `terminal_action_failed` if invalid actions continue in terminal phase. This protects the loop without consuming valid planning steps.

Use this exact invalid-action transition:

```ts
invalidModelActionCount += 1;
messages.push({
  role: "system",
  content: "该输出不是可执行的面试动作。请调用当前可用工具。",
});
if (invalidModelActionCount >= MAX_INVALID_MODEL_ACTIONS) {
  if (phase === "terminal") {
    return failRun(
      options,
      "terminal_action_failed",
      new Error("Agent repeatedly returned invalid terminal actions"),
      planningStepCount,
    );
  }
  phase = "terminal";
  invalidModelActionCount = 0;
}
continue;
```

Map model errors precisely:

```ts
} catch (error) {
  return options.signal.aborted
    ? failRun(options, "aborted_streaming", error, planningStepCount)
    : failRun(options, "provider_failed", error, planningStepCount);
}
```

Save `turnCount: planningStepCount`, the current `phase`, and `terminalAttemptCount` in checkpoints. Successful terminal tools still commit response events and complete the Run exactly once.

- [ ] **Step 7: Run runtime tests**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/runtime-policy.test.ts lib/interview/agent/runtime.test.ts lib/interview/agent/recovery.test.ts lib/interview/agent/worker.test.ts
```

Expected: all tests PASS and the failed-Run regression reaches `completed`.

- [ ] **Step 8: Commit the runtime budget change**

```bash
git add lib/interview/agent/runtime-policy.ts lib/interview/agent/runtime-policy.test.ts lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts lib/interview/agent/contracts.ts
git commit -m "fix(interview): separate planning and terminal budgets"
```

---

### Task 4: Preserve Precise Failure Messages Across SSE and Refresh

**Files:**
- Create: `lib/interview/agent/exit-messages.ts`
- Create: `lib/interview/agent/exit-messages.test.ts`
- Modify: `lib/interview/agent/repository.ts:598-624`
- Test: `lib/interview/agent/repository.test.ts`
- Modify: `app/api/interviews/[id]/route.ts:42-98`
- Modify: `app/api/interviews/[id]/runs/[runId]/route.ts:43-50`
- Modify: `app/(app)/interviews/[interviewId]/room/page.tsx:47-57`
- Modify: `components/interview/use-agent-run-stream.ts:4-12`
- Modify: `components/interview/agent-interview-room.tsx:112-126`

**Interfaces:**
- Produces: `agentExitMessage(reason: AgentExitReason | null): string | null` and `AgentRunStreamStatus.userMessage`.
- Consumes: persisted `exitReason` from both interview refresh and run reconnect APIs.

- [ ] **Step 1: Write the exact-copy tests**

Create `exit-messages.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { agentExitMessage } from "./exit-messages";

test("maps precise interview agent failures", () => {
  assert.equal(agentExitMessage("terminal_action_failed"), "本轮问题生成未能通过运行规则，请重试。");
  assert.equal(agentExitMessage("provider_failed"), "模型服务暂时不可用，请稍后重试。");
  assert.equal(agentExitMessage("blocking_limit"), "检测到重复处理，本轮已停止，请重试。");
  assert.equal(agentExitMessage(null), null);
});
```

Extend `repository.test.ts` to terminate a Run with `terminal_action_failed` and assert the persisted `run_failed.payload.userMessage` equals the same copy.

- [ ] **Step 2: Run tests and verify the mapper is missing**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/exit-messages.test.ts lib/interview/agent/repository.test.ts
```

Expected: FAIL because `exit-messages.ts` does not exist.

- [ ] **Step 3: Centralize exit messages**

Create `exit-messages.ts` with a complete `Record<AgentExitReason, string>` including historical reasons:

```ts
import type { AgentExitReason } from "./contracts";

const messages: Record<AgentExitReason, string> = {
  completed: "本轮处理已完成。",
  max_turns: "本轮处理达到最大步骤数，请重试。",
  provider_failed: "模型服务暂时不可用，请稍后重试。",
  terminal_action_failed: "本轮问题生成未能通过运行规则，请重试。",
  aborted_streaming: "模型连接中断，请重试本轮回答。",
  aborted_tools: "后台操作中断，请重试。",
  hook_stopped: "本轮处理被安全规则终止。",
  blocking_limit: "检测到重复处理，本轮已停止，请重试。",
  prompt_too_long: "面试上下文过长，暂时无法继续。",
};

export function agentExitMessage(reason: AgentExitReason | null) {
  return reason ? messages[reason] : null;
}
```

Import this function in `repository.ts` and delete its private `defaultExitMessage`.

- [ ] **Step 4: Return the same message from refresh and reconnect APIs**

Map latest runs in `app/api/interviews/[id]/route.ts`:

```ts
latestRun: latestRuns[0]
  ? { ...latestRuns[0], userMessage: agentExitMessage(latestRuns[0].exitReason as AgentExitReason | null) }
  : null,
```

Return the same field from the individual Run route:

```ts
userMessage: agentExitMessage(run.exitReason),
```

Add `userMessage: string | null` to `AgentRunStreamStatus`. When creating a local running status after submission, set `userMessage: null`.

Add the same field to the page-level response type:

```ts
latestRun: {
  id: string;
  status: "running" | "completed" | "failed";
  exitReason: string | null;
  userMessage: string | null;
  lastEventSequence: number;
} | null;
```

- [ ] **Step 5: Use persisted user copy in terminal fallback**

Replace the raw exit-reason UI fallback:

```ts
if (terminal.status === "failed") {
  dispatch({ type: "run_failed", runId: terminal.id });
  setError(terminal.userMessage ?? "本轮生成未完成，请重新提交或稍后重试。");
}
```

Keep the SSE `run_failed.payload.userMessage` path unchanged so both delivery paths show identical copy.

- [ ] **Step 6: Run failure-path tests and typecheck**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/exit-messages.test.ts lib/interview/agent/repository.test.ts lib/interview/agent/sse.test.ts lib/interview/agent/client-stream.test.ts
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript reports no errors.

- [ ] **Step 7: Commit the error-contract change**

```bash
git add lib/interview/agent/exit-messages.ts lib/interview/agent/exit-messages.test.ts lib/interview/agent/repository.ts lib/interview/agent/repository.test.ts 'app/api/interviews/[id]/route.ts' 'app/api/interviews/[id]/runs/[runId]/route.ts' 'app/(app)/interviews/[interviewId]/room/page.tsx' components/interview/use-agent-run-stream.ts components/interview/agent-interview-room.tsx
git commit -m "fix(interview): preserve precise agent failure messages"
```

---

### Task 5: Render Explicit Interview Turn Groups

**Files:**
- Create: `components/interview/interview-room-timeline.ts`
- Create: `components/interview/interview-room-timeline.test.ts`
- Modify: `components/interview/agent-interview-room.tsx:170-199`

**Interfaces:**
- Consumes: `RoomMessage[]` from `lib/interview/agent/room-state.ts`.
- Produces: `buildInterviewRoomTimeline(messages): InterviewRoomTimelineGroup[]` with `beforeTurn`, `runId`, and `afterTurn` message arrays.

- [ ] **Step 1: Write timeline grouping tests**

Create `interview-room-timeline.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewRoomTimeline } from "./interview-room-timeline";

test("groups a candidate answer, its run state, and the resulting question", () => {
  const groups = buildInterviewRoomTimeline([
    { id: "q1", sequence: 1, runId: "opening", role: "assistant", kind: "opening", content: "请自我介绍？" },
    { id: "a1", sequence: 2, runId: "answer-run", role: "user", kind: "answer", content: "我的回答" },
    { id: "q2", sequence: 3, runId: "answer-run", role: "assistant", kind: "question", content: "请具体说明？" },
  ]);
  assert.deepEqual(groups.map((group) => ({
    runId: group.runId,
    before: group.beforeTurn.map((message) => message.id),
    after: group.afterTurn.map((message) => message.id),
  })), [
    { runId: "opening", before: [], after: ["q1"] },
    { runId: "answer-run", before: ["a1"], after: ["q2"] },
  ]);
});

test("keeps a pending candidate message as a standalone group", () => {
  const [group] = buildInterviewRoomTimeline([
    { id: "local", sequence: null, role: "user", kind: "answer", content: "发送中", status: "sending" },
  ]);
  assert.equal(group.runId, null);
  assert.deepEqual(group.beforeTurn.map((message) => message.id), ["local"]);
  assert.deepEqual(group.afterTurn, []);
});
```

- [ ] **Step 2: Run the timeline test and verify it fails**

Run:

```bash
pnpm exec tsx --test components/interview/interview-room-timeline.test.ts
```

Expected: FAIL because the timeline builder does not exist.

- [ ] **Step 3: Implement the pure timeline builder**

Create `interview-room-timeline.ts`:

```ts
import type { RoomMessage } from "@/lib/interview/agent/room-state";

export type InterviewRoomTimelineGroup = {
  key: string;
  runId: string | null;
  beforeTurn: RoomMessage[];
  afterTurn: RoomMessage[];
};

export function buildInterviewRoomTimeline(messages: readonly RoomMessage[]) {
  const consumed = new Set<string>();
  return messages.flatMap<InterviewRoomTimelineGroup>((message) => {
    if (consumed.has(message.id)) return [];
    consumed.add(message.id);
    if (!message.runId) {
      return [{ key: message.id, runId: null, beforeTurn: [message], afterTurn: [] }];
    }
    if (message.role === "user") {
      const reply = messages.find((candidate) =>
        !consumed.has(candidate.id) &&
        candidate.runId === message.runId &&
        candidate.role === "assistant"
      );
      if (reply) consumed.add(reply.id);
      return [{
        key: `turn:${message.runId}`,
        runId: message.runId,
        beforeTurn: [message],
        afterTurn: reply ? [reply] : [],
      }];
    }
    return [{
      key: `turn:${message.runId}`,
      runId: message.runId,
      beforeTurn: [],
      afterTurn: [message],
    }];
  });
}
```

- [ ] **Step 4: Render groups with the approved spacing**

In `agent-interview-room.tsx`, memoize only the non-trivial timeline derivation:

```ts
const timeline = useMemo(
  () => buildInterviewRoomTimeline(room.messages),
  [room.messages],
);
```

Import `useMemo`, delete `userRunIds`, add a `renderMessage` helper, change `renderTurn` to `space-y-3`, and render:

```tsx
<div className="flex-1 space-y-7 overflow-y-auto px-6 py-8">
  {timeline.map((group) => (
    <div className="space-y-3" key={group.key}>
      {group.beforeTurn.map(renderMessage)}
      {group.runId ? renderTurn(group.runId) : null}
      {group.afterTurn.map(renderMessage)}
    </div>
  ))}
  {busy && run?.id && !room.messages.some((message) => message.runId === run.id)
    ? <div className="space-y-3">{renderTurn(run.id)}</div>
    : null}
  {/* Keep reconnect, manual retry, and error rows after the timeline. */}
</div>
```

`renderMessage` must preserve the existing user/assistant widths, colors, Markdown rendering, and failed-message ring. Do not change typography, bubble padding, header, or composer.

- [ ] **Step 5: Run timeline and room-state tests**

Run:

```bash
pnpm exec tsx --test components/interview/interview-room-timeline.test.ts lib/interview/agent/room-state.test.ts
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Manually verify the approved layout**

Run `pnpm dev`, open:

```text
http://localhost:3000/interviews/fa7ba690-3d69-4c95-8a53-1bacf6b520ed/room
```

Verify:

- the candidate answer, its thinking summary, artifacts, and resulting interviewer question form one visual group;
- blocks inside that group are 12px apart (`space-y-3`);
- adjacent groups are 28px apart (`space-y-7`);
- the failed Run stays expanded;
- no message disappears or renders twice.

- [ ] **Step 7: Commit the timeline UI change**

```bash
git add components/interview/interview-room-timeline.ts components/interview/interview-room-timeline.test.ts components/interview/agent-interview-room.tsx
git commit -m "fix(interview): group room messages by agent turn"
```

---

### Task 6: Full Regression and Delivery Verification

**Files:**
- Verify only; modify the owning task if a check fails.

**Interfaces:**
- Consumes: all deliverables from Tasks 1-5.
- Produces: a buildable, lint-clean interview room with regression evidence.

- [ ] **Step 1: Confirm removed and retained constraints**

Run:

```bash
! rg -n "UNSUPPORTED_FACT|validateGroundedClaims|MAX_PROVIDER_ATTEMPTS|MAX_MODEL_TURNS" lib/interview/agent
rg -n "EVIDENCE_NOT_FOUND|SOURCE_NOT_FOUND|MAX_PLANNING_STEPS|MAX_TERMINAL_ATTEMPTS" lib/interview/agent
```

Expected: the first command exits 0 with no matches; the second finds all four retained/new controls.

- [ ] **Step 2: Run the complete automated test suite**

Run:

```bash
pnpm test
```

Expected: all Node tests PASS.

- [ ] **Step 3: Run static verification**

Run:

```bash
pnpm lint
npx tsc --noEmit
```

Expected: both commands exit 0 with no errors.

- [ ] **Step 4: Run the production build**

Run:

```bash
pnpm build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 5: Exercise a real answer Run**

With the local authenticated session, submit one answer on the specified interview room and inspect the persisted Run events. Expected sequence:

```text
run_started
thinking_started / thinking_summary
zero or more planning tool calls (maximum 15)
ask_interview_question or finish_interview
message_committed
run_completed
```

Verify that provider fallback attempts do not end the Run as `max_turns`, a missing source ID receives a repair opportunity, and a successful terminal action never increments the persisted planning `turnCount`.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git status --short
git diff --check HEAD~5..HEAD
git log -5 --oneline
```

Expected: no unintended files, no whitespace errors, and one focused commit for each implementation task.
