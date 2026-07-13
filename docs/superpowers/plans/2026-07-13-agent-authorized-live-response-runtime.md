# Agent Authorized Live Response Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace post-commit fake streaming with one Agent loop that streams public reasoning, calls read-only tools, authorizes a structured proposal before exposing `responseText`, and atomically commits the assessment and interview outcome.

**Architecture:** Vercel AI SDK `streamText().fullStream` exposes public text and real tool-input deltas. Read tools may feed results into another model call; one terminal `submit_interview_turn` tool emits an authorizable prefix before its final `responseText`. Runtime freezes a normalized prefix hash, persists genuine deltas, validates the final payload, then commits assessment, coverage, message, and `message_committed` in one fenced transaction.

**Tech Stack:** TypeScript strict mode, Vercel AI SDK 7, Zod 4, Node crypto, Drizzle ORM, PostgreSQL, existing Agent leases/checkpoints/AttemptController.

## Global Constraints

- Normal no-tool turns must not make a fixed Renderer or Validator model call.
- Provider-hidden reasoning deltas are never public; only prompted assistant text is public reasoning.
- Analysis tools are read-only; all domain writes occur in the terminal commit transaction.
- `responseText` must be the final terminal-tool field and cannot be released before proposal authorization.
- Authorization uses projected state: committed state plus the current proposed assessment and coverage changes.
- Final commit revalidates under interview/run locks and the active fencing token.
- A visible failed attempt must emit `attempt_discarded` or `response_discarded` before retry.
- Preserve category maximum 3, answer maximum 20, resume grounding, opening restrictions, and completion rules.
- Do not alter formal six-dimension scoring or report generation.
- Do not add a runtime version branch or non-PostgreSQL infrastructure.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/interview/agent/turn-proposal.ts` | Proposal schemas, partial-prefix extraction, normalization, hashing |
| `lib/interview/agent/turn-authorizer.ts` | Projected-state authorization |
| `lib/interview/agent/response-validator.ts` | Incremental/final deterministic response checks |
| `lib/interview/agent/model-port.ts` | AI SDK full-stream adapter and typed stream events |
| `lib/interview/agent/tool-registry.ts` | Three read tools plus terminal `submit_interview_turn` |
| `lib/interview/agent/runtime.ts` | State machine, coalescers, authorization gate, repair flow |
| `lib/interview/agent/composition.ts` | Production context and handlers without independent assessment |
| `lib/interview/agent/repository.ts` | Proposal checkpoint and atomic `commitTurnOutcome` |
| `lib/db/schema.ts`, `lib/db/migrate.ts` | Queryable run authorization fields |
| `scripts/interview-agent-contract.ts` | Real-provider acceptance assertions |

### Task 1: Proposal prefix and response validators

**Files:**
- Create: `lib/interview/agent/turn-proposal.ts`
- Create: `lib/interview/agent/turn-proposal.test.ts`
- Create: `lib/interview/agent/response-validator.ts`
- Create: `lib/interview/agent/response-validator.test.ts`

**Interfaces:**
- Produces: `interviewTurnProposalSchema`, `turnProposalPrefixSchema`, `readTurnProposalProgress`, `hashTurnProposalPrefix`.
- Produces: `validateFinalResponse(input): ResponseValidationResult`.

- [ ] **Step 1: Write failing prefix tests**

```ts
test("requires a complete prefix before response text", () => {
  assert.deepEqual(readTurnProposalProgress({ responseText: "提前输出" }), {
    status: "protocol_violation",
    responseText: "提前输出",
  });
  const progress = readTurnProposalProgress(validQuestionPrefix());
  assert.equal(progress.status, "prefix_ready");
  assert.equal(progress.responseText, "");
});

test("hashes normalized prefixes deterministically", () => {
  const prefix = turnProposalPrefixSchema.parse(validOpeningPrefix());
  assert.equal(hashTurnProposalPrefix(prefix), hashTurnProposalPrefix(structuredClone(prefix)));
  assert.match(hashTurnProposalPrefix(prefix), /^[a-f0-9]{64}$/);
});
```

Define `validQuestionPrefix` and `validOpeningPrefix` in the test with complete assessment, coverage, decision, and evidence values.

- [ ] **Step 2: Write failing response tests**

```ts
test("accepts one grounded question and rejects unsafe final text", () => {
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你提到了 30 秒回退机制，能说明自动降级的触发条件吗？",
    allowedTerms: ["30 秒", "回退机制", "自动降级"],
  }), { ok: true });
  assert.equal(validateFinalResponse({ action: "ask", language: "zh", text: "为什么？如何处理？", allowedTerms: [] }).ok, false);
  assert.equal(validateFinalResponse({ action: "ask", language: "zh", text: "你的逻辑性是 8 分。为什么？", allowedTerms: [] }).ok, false);
  assert.equal(validateFinalResponse({ action: "finish", language: "zh", text: "结束了，还有问题吗？", allowedTerms: [] }).ok, false);
});
```

- [ ] **Step 3: Run tests and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/turn-proposal.test.ts lib/interview/agent/response-validator.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement the strict proposal contract**

```ts
export const turnProposalPrefixSchema = z.object({
  assessment: answerAssessmentSchema.nullable(),
  coverageChanges: z.array(z.object({
    category: questionCategorySchema,
    topic: z.string().trim().min(1).max(200),
    status: coverageStatusSchema,
    resumeEvidenceIds: z.array(z.string().min(1)).max(20),
  }).strict()).max(9),
  decision: z.discriminatedUnion("action", [
    z.object({
      action: z.enum(["ask", "clarify"]),
      category: questionCategorySchema,
      intent: z.enum(["new_topic", "follow_up", "verify_evidence"]),
      evidenceIds: z.array(z.string().min(1)).max(20),
      coverageTarget: z.string().trim().min(1).max(500),
      estimatedInformationGain: z.enum(["low", "medium", "high"]),
    }).strict(),
    z.object({
      action: z.literal("finish"),
      completionReason: z.enum(["coverage_sufficient", "low_information_gain", "user_requested", "max_rounds"]),
    }).strict(),
  ]),
}).strict();

export const interviewTurnProposalSchema = turnProposalPrefixSchema.extend({
  responseText: z.string().trim().min(1).max(2_000),
}).strict();
```

`readTurnProposalProgress` returns `protocol_violation` when non-empty response text exists before the prefix parses. Hash the Zod-normalized prefix with SHA-256 over `JSON.stringify(prefix)`.

- [ ] **Step 5: Implement deterministic final validation**

```ts
export type ResponseValidationResult =
  | { ok: true }
  | { ok: false; code: "MULTIPLE_QUESTIONS" | "FINISH_ASKS_QUESTION" | "FORMAL_SCORE" | "LANGUAGE_MISMATCH" | "UNAUTHORIZED_TERM"; message: string };

export function validateFinalResponse(input: {
  action: "ask" | "clarify" | "finish";
  language: "zh" | "en" | "es" | "de";
  text: string;
  allowedTerms: readonly string[];
}): ResponseValidationResult;
```

Count language-aware question punctuation, reject formal numeric score phrases, and reuse grounding normalization to detect new capitalized entities or numbers. This module must not call a model.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/turn-proposal.test.ts lib/interview/agent/response-validator.test.ts
npx tsc --noEmit
git add lib/interview/agent/turn-proposal.ts lib/interview/agent/turn-proposal.test.ts lib/interview/agent/response-validator.ts lib/interview/agent/response-validator.test.ts
git commit -m "feat(agent): define authorized turn proposals"
```

Expected: tests and typecheck PASS.

### Task 2: Projected-state authorization

**Files:**
- Create: `lib/interview/agent/turn-authorizer.ts`
- Create: `lib/interview/agent/turn-authorizer.test.ts`
- Modify: `lib/interview/agent/limits.ts`
- Modify: `lib/interview/agent/limits.test.ts`

**Interfaces:**
- Consumes: `TurnProposalPrefix` and existing `InterviewAgentState`.
- Produces: `authorizeTurnProposal(input): AuthorizedTurnProposal | RejectedTurnProposal`.

- [ ] **Step 1: Write failing projection tests**

```ts
test("uses the current assessment for low information gain", () => {
  const result = authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 6, consecutiveNoFollowUpAssessments: 1 }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({ followUpNeeded: false, reason: "low_information_gain" }),
  });
  assert.equal(result.allowed, true);
});

test("projects current coverage before coverage-sufficient completion", () => {
  const result = authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 6, categoryStatuses: threeTouchedWithTechnicalPartial() }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({ followUpNeeded: false, reason: "coverage_sufficient", coverageStatus: "sufficient" }),
  });
  assert.equal(result.allowed, true);
});

test("forbids an assessment during opening", () => {
  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 0 }),
    mode: "opening",
    answerCategory: null,
    prefix: askPrefix({ assessment: validAssessment() }),
  }), { allowed: false, reason: "OPENING_ASSESSMENT_FORBIDDEN" });
});
```

The fixture helpers must return complete typed state and proposal objects.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/turn-authorizer.test.ts
```

Expected: FAIL because the authorizer does not exist.

- [ ] **Step 3: Implement normalized projected authorization**

```ts
export type AuthorizedTurnProposal = {
  allowed: true;
  prefix: TurnProposalPrefix;
  proposalHash: string;
  projectedState: {
    consecutiveNoFollowUpAssessments: number;
    categoryStatuses: Record<string, CoverageStatus>;
  };
};

export function authorizeTurnProposal(input: {
  state: InterviewAgentState;
  mode: "opening" | "answer";
  answerCategory: QuestionCategory | null;
  prefix: TurnProposalPrefix;
}): AuthorizedTurnProposal | { allowed: false; reason: string };

export function projectAssessmentCoverage(assessment: AnswerAssessment) {
  return {
    depth: { low: 1, medium: 2, high: 3 }[assessment.completeness],
    evidenceQuality: { weak: 1, partial: 2, strong: 3 }[assessment.evidenceStrength],
    status: assessment.followUpNeeded ? "partial" as const : "sufficient" as const,
  };
}
```

For answer mode, require an assessment and derive its category-level depth, evidence quality, and status with `projectAssessmentCoverage`; this helper moves the deterministic mapping out of the soon-to-be-deleted assessment service. Merge that derived category status with normalized `coverageChanges`, rejecting contradictory duplicate categories. For opening, require `assessment === null` and no coverage changes. Pass projected counters/statuses into the existing pure `authorizeInterviewAction` and hash only the normalized prefix.

- [ ] **Step 4: Preserve all existing hard-rule tests**

Update `limits.test.ts` so the current proposed assessment participates in the low-information-gain counter. Keep tests for fourth-category-question rejection, 20 rounds, user end, duplicate question, missing evidence, opening finish, and minimum completion coverage.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/turn-authorizer.test.ts lib/interview/agent/limits.test.ts
npx tsc --noEmit
git add lib/interview/agent/turn-authorizer.ts lib/interview/agent/turn-authorizer.test.ts lib/interview/agent/limits.ts lib/interview/agent/limits.test.ts
git commit -m "feat(agent): authorize projected turn state"
```

Expected: tests and typecheck PASS.

### Task 3: Atomic turn outcome transaction

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`
- Modify: `lib/interview/agent/repository.ts`
- Modify: `lib/interview/agent/repository.test.ts`
- Modify: `lib/interview/agent/repository.integration.test.ts`

**Interfaces:**
- Produces: `authorizeProposal(input)` and `commitTurnOutcome(input)`.
- Replaces runtime use of `commitCoverageUpdate`, `commitQuestionOutcome`, and `commitFinishOutcome`.

- [ ] **Step 1: Write failing atomicity tests**

```ts
test("commits assessment coverage message and committed event once", async () => {
  const fixture = await createAnsweredRunFixture();
  const input = questionTurnOutcomeInput(fixture, { toolCallId: "submit-1" });
  const first = await fixture.repository.commitTurnOutcome(input);
  const replay = await fixture.repository.commitTurnOutcome(input);
  assert.equal(replay.messageId, first.messageId);
  assert.equal(fixture.inspect().assessments.length, 1);
  assert.equal(fixture.inspect().questions.length, 1);
  assert.equal(fixture.inspect().messageCommittedEvents.length, 1);
});

test("a stale proposal hash leaves no partial writes", async () => {
  const fixture = await createAnsweredRunFixture();
  await assert.rejects(fixture.repository.commitTurnOutcome(questionTurnOutcomeInput(fixture, {
    proposalHash: "0".repeat(64),
  })), /proposal hash/i);
  assert.equal(fixture.inspect().assessments.length, 0);
  assert.equal(fixture.inspect().questions.length, 0);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/repository.test.ts
```

Expected: FAIL because the new repository methods do not exist.

- [ ] **Step 3: Add queryable run fields**

```ts
phase: text("phase").notNull().default("accepted"),
authorizedProposalJson: jsonb("authorized_proposal_json"),
authorizedProposalHash: text("authorized_proposal_hash"),
proposalAuthorizedAt: timestamp("proposal_authorized_at", { withTimezone: true }),
responseStartedAt: timestamp("response_started_at", { withTimezone: true }),
```

Add matching idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements. Do not add a runtime-version column.

- [ ] **Step 4: Define repository inputs**

```ts
export type CommitTurnOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease: RunLeaseToken;
  logicalMessageId: string;
  attemptId: string;
  answerMessageId: string | null;
  proposal: TurnProposalPrefix;
  proposalHash: string;
  responseText: string;
  language: "zh" | "en" | "es" | "de";
};
```

`authorizeProposal` writes normalized proposal JSON/hash, phase, timestamp, and checkpoint under the current fence.

- [ ] **Step 5: Implement the fixed transaction order**

In one transaction: acquire interview and run advisory locks; require active fenced run; return existing tool commit if present; compare stored hash; load locked policy state; reconstruct projected authorization; insert the unique assessment; apply normalized coverage; create question/message or finish message/completion job; increment `last_event_sequence`; insert public `message_committed` with the full authoritative message object; insert terminal tool commit; return the committed outcome.

Use these exact postconditions:

```ts
type CommittedTurnOutcome = {
  messageId: string;
  messageSequence: number;
  responseText: string;
  message: { id: string; runId: string; sequence: number; role: "assistant"; kind: "question" | "finish" | "clarification"; content: string };
  committedEventSequence: number;
  committed: true;
};
```

- [ ] **Step 6: Add real PostgreSQL concurrency coverage**

Run two identical terminal commits concurrently and assert one assessment, one message, one tool commit, and one committed event. Force a category-limit failure and assert none of those rows are inserted.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/repository.test.ts
pnpm exec tsx --env-file=.env --test lib/interview/agent/repository.integration.test.ts
npx tsc --noEmit
git add lib/db/schema.ts lib/db/migrate.ts lib/interview/agent/repository.ts lib/interview/agent/repository.test.ts lib/interview/agent/repository.integration.test.ts
git commit -m "feat(agent): commit complete turns atomically"
```

Expected: unit tests PASS; integration PASS or SKIP only without `DATABASE_URL`; typecheck PASS.

### Task 4: AI SDK full stream and terminal tool

**Files:**
- Modify: `lib/interview/agent/model-port.ts`
- Modify: `lib/interview/agent/model-port.test.ts`
- Modify: `lib/interview/agent/tool-registry.ts`
- Modify: `lib/interview/agent/tool-registry.test.ts`
- Modify: `lib/interview/agent/attempt-controller.ts`
- Modify: `lib/interview/agent/attempt-controller.test.ts`
- Modify: `lib/interview/agent/runtime-policy.ts`

**Interfaces:**
- Produces: `AgentModelStreamEvent` and `onStreamEvent(event)`.
- Produces one terminal tool: `submit_interview_turn`.
- Preserves automatic model fallback only before public content is accepted.

- [ ] **Step 1: Write failing full-stream tests**

Use this fake stream in `model-port.test.ts`:

```ts
const fullStream = async function* () {
  yield { type: "text-delta", text: "先核对证据。" } as const;
  yield { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" } as const;
  yield { type: "tool-input-delta", id: "call-1", delta: firstJsonChunk } as const;
  yield { type: "tool-input-delta", id: "call-1", delta: secondJsonChunk } as const;
  yield { type: "tool-call", toolCallId: "call-1", toolName: "submit_interview_turn", input: openingProposal } as const;
};
```

Assert `onStreamEvent` receives one `public_reasoning_delta`, two growing `tool_input_delta` events with parsed partial input, and the returned step is the complete terminal tool call. Add a separate case proving provider `reasoning-delta` is ignored.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/model-port.test.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/attempt-controller.test.ts
```

Expected: FAIL because the current port consumes structured partial output and old terminal tools.

- [ ] **Step 3: Define the stream interface**

```ts
export type AgentModelStreamEvent =
  | { type: "public_reasoning_delta"; attemptId: string; text: string }
  | { type: "tool_input_delta"; attemptId: string; toolCallId: string; toolName: string; inputText: string; partialInput: unknown };

export interface InterviewAgentModelPort {
  nextStep(input: NextStepInput): Promise<AgentModelStep>;
  nextStepStream(input: NextStepInput & {
    onAttemptStarted?: (attempt: StartedAttempt) => Promise<void>;
    onProviderProgress: () => Promise<void>;
    onStreamEvent: (event: AgentModelStreamEvent) => Promise<void>;
  }): Promise<{ step: AgentModelStep; attemptId: string; provisionalMessageId: string }>;
}
```

- [ ] **Step 4: Replace structured-output streaming with real tools**

```ts
const result = streamText({
  model: provider.model,
  system: AGENT_SYSTEM_PROMPT,
  prompt: buildPrompt(input),
  tools: createProviderToolSet(input.tools),
  toolChoice: "required",
  abortSignal: input.signal,
  maxRetries: 0,
});
```

Map descriptors with AI SDK `tool({ description, inputSchema })` and no `execute`. Iterate `result.fullStream`: publish only `text-delta`, ignore hidden `reasoning-delta`, track tool names from `tool-input-start`, accumulate JSON from `tool-input-delta`, parse with `parsePartialJson`, and return the final `tool-call` as `AgentModelStep`.

- [ ] **Step 5: Collapse model-visible tools**

```ts
export const interviewToolNames = [
  "get_resume_evidence",
  "get_interview_history",
  "get_coverage_state",
  "submit_interview_turn",
] as const;
```

Use `interviewTurnProposalSchema` for the terminal input. Remove `update_coverage`, `ask_interview_question`, and `finish_interview` from model-visible schemas/descriptions. `runtime-policy.ts` recognizes only `submit_interview_turn` as terminal.

- [ ] **Step 6: Keep attempts monotonic across visible failures**

Add `attemptNumberOffset` to `runAgentAttempts`. Call `acceptProvisional()` after the first public event is durably appended. A later failure returns `PROVISIONAL_STREAM_ABORTED` to Runtime; pre-public transient failures still retry twice per model and fall back.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/model-port.test.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/attempt-controller.test.ts
npx tsc --noEmit
git add lib/interview/agent/model-port.ts lib/interview/agent/model-port.test.ts lib/interview/agent/tool-registry.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/attempt-controller.ts lib/interview/agent/attempt-controller.test.ts lib/interview/agent/runtime-policy.ts
git commit -m "feat(agent): stream reasoning and tool input"
```

Expected: tests and typecheck PASS.

### Task 5: Runtime authorization gate and repair loop

**Files:**
- Modify: `lib/interview/agent/runtime.ts`
- Modify: `lib/interview/agent/runtime.test.ts`
- Modify: `lib/interview/agent/contracts.ts`

**Interfaces:**
- Consumes: model stream events, authorizer, validators, coalescer, durable events, and atomic commit.
- Produces the confirmed Runtime event sequence and checkpoint phases.

- [ ] **Step 1: Write failing live-order tests**

```ts
test("publishes live response before domain commit", async () => {
  const gate = deferred<void>();
  const fixture = runtimeFixture(streamingTerminalModel({ beforeFinal: gate.promise }));
  const running = runInterviewAgent(fixture.options);
  await fixture.waitForEvent("response_delta");
  assert.equal(fixture.inspectCommittedMessages().length, 0);
  gate.resolve();
  await running;
  const types = fixture.publicEventTypes();
  assert.ok(types.indexOf("reasoning_delta") < types.indexOf("proposal_authorized"));
  assert.ok(types.indexOf("proposal_authorized") < types.indexOf("response_started"));
  assert.ok(types.indexOf("response_delta") < types.indexOf("message_committed"));
});

test("rejects a proposal before exposing response text", async () => {
  const fixture = runtimeFixture(categoryLimitModel());
  await runInterviewAgent(fixture.options);
  assert.equal(fixture.publicEventTypes().includes("response_started"), false);
  assert.equal(fixture.publicEventTypes().includes("attempt_discarded"), true);
});

test("discards a visible response before repair", async () => {
  const fixture = runtimeFixture(failOnceAfterResponseThenSucceed());
  await runInterviewAgent(fixture.options);
  const types = fixture.publicEventTypes();
  assert.ok(types.indexOf("response_discarded") < types.lastIndexOf("response_started"));
  assert.equal(fixture.inspectCommittedMessages().length, 1);
});
```

Implement the deferred and model fixtures in `runtime.test.ts` with concrete async generators.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec tsx --test lib/interview/agent/runtime.test.ts
```

Expected: FAIL because current Runtime buffers all deltas until commit.

- [ ] **Step 3: Replace phases and delete synthetic chunking**

Use phases `accepted`, `reasoning`, `tool_running`, `proposal_streaming`, `authorized`, `responding`, `validating`, `committing`, `repairing`, and recovery-only `acting`. Delete `chunkResponse` and the post-commit delta loop.

- [ ] **Step 4: Persist public reasoning and response through coalescers**

```ts
const reasoning = createEventCoalescer({
  write: (text) => appendPublicEvent("reasoning_delta", {
    runId, attemptId, entryId: `reasoning:${attemptId}`, text,
  }),
});
const response = createEventCoalescer({
  write: (text) => appendPublicEvent("response_delta", {
    runId, attemptId, logicalMessageId, text, provisional: true,
  }),
});
```

Implement `appendPublicEvent` as the only Runtime public-event writer: require the type to exist in `publicAgentEventTypes`, parse the payload through `publicAgentEventPayloadSchemas[type]`, and call `repository.appendEvent` with `visibility: "public"`, current `attemptId`, `logicalMessageId`, and lease. Internal checkpoints continue through a separate internal writer.

Append `reasoning_started` on the first public reasoning text. Flush before a tool lifecycle boundary, attempt discard, response finish, or commit.

For each authorized read tool, flush reasoning, append `tool_call_started`, execute through the existing validated tool pipeline, then append `tool_call_completed` before returning the result to the model. Map tool names to fixed public labels in `tool-registry.ts`; never include raw arguments, resume contents, history, or tool results in the public lifecycle payload. The terminal `submit_interview_turn` is represented by `proposal_authorized` and must not emit a fake completed read-tool event.

- [ ] **Step 5: Gate terminal response on prefix authorization**

For each terminal `tool_input_delta`, call `readTurnProposalProgress`. Reject `protocol_violation`. On `prefix_ready`, load state, call `authorizeTurnProposal`, persist `authorizeProposal`, append `proposal_authorized`, flush reasoning, and append `reasoning_completed`. Only then append the growing `responseText` suffix through the response coalescer and emit `response_started` once.

- [ ] **Step 6: Validate and commit**

After the complete terminal call: flush response; compare the full normalized prefix hash with the stored hash; run `validateFinalResponse`; append `response_finished`; set `committing`; call `commitTurnOutcome`; save `acting`; terminate completed. Do not append another `message_committed` outside the transaction.

- [ ] **Step 7: Implement explicit discard and repair**

```ts
await reasoning.dispose();
await response.dispose();
await appendPublicEvent(responseStarted ? "response_discarded" : "attempt_discarded", {
  runId,
  attemptId,
  logicalMessageId,
  reason: classifyAttemptFailure(error),
});
messages.push({ role: "system", content: repairInstruction(error, authorizedProposal) });
phase = "repairing";
continue;
```

Preserve the logical message ID, increment attempt number, and enforce the existing terminal-attempt budget.

- [ ] **Step 8: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/interview/agent/attempt-controller.test.ts
npx tsc --noEmit
git add lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts lib/interview/agent/contracts.ts
git commit -m "feat(agent): stream authorized live responses"
```

Expected: tests and typecheck PASS; the test observes a response delta before commit.

### Task 6: Merge assessment into production composition

**Files:**
- Modify: `lib/interview/agent/composition.ts`
- Create: `lib/interview/agent/composition.test.ts`
- Modify: `lib/interview/agent/context/assembler.ts`
- Modify: `lib/interview/agent/context/assembler.test.ts`
- Modify: `lib/interview/agent/repository.integration.test.ts`
- Delete: `lib/interview/agent/assessment-service.ts`
- Delete: `lib/interview/agent/assessment-service.test.ts`
- Delete: `lib/interview/agent/assessment.ts`
- Delete: `lib/interview/agent/assessment.test.ts`

**Interfaces:**
- Consumes: terminal proposal and atomic commit.
- Produces: production dependencies with read-only analysis tools.

- [ ] **Step 1: Write a failing architecture test**

Create `lib/interview/agent/composition.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production composition has no pre-loop assessment model call", async () => {
  const source = await readFile(new URL("./composition.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ensureLatestAnswerAssessment|assessAnswer|answer\.assess/);
});
```

Run `pnpm exec tsx --test lib/interview/agent/composition.test.ts`. Expected: FAIL because production composition still imports and invokes `ensureLatestAnswerAssessment`.

- [ ] **Step 2: Remove pre-loop assessment orchestration**

Delete `ensureLatestAnswerAssessment`, `publicThinkingSummary`, and the committed-current-assessment precondition from `composition.ts`. Pass the latest answer ID/category and configured language/persona into Runtime context.

- [ ] **Step 3: Keep only read handlers plus terminal commit**

Keep `get_resume_evidence`, `get_interview_history`, and `get_coverage_state`. Implement `submit_interview_turn` by requiring tool call ID, attempt ID, provisional message ID, lease, and authorized proposal hash, then calling `repository.commitTurnOutcome` with the full terminal payload.

- [ ] **Step 4: Update prompt and context**

The system prompt must require public reasoning text before a structured tool, forbid hidden reasoning leakage, and require `responseText` last. Answer context contains the latest raw answer and prior committed assessments; it no longer claims the current assessment already exists.

- [ ] **Step 5: Remove obsolete assessment modules**

Remove the assessment-service import and assessment-specific integration cases from `repository.integration.test.ts`. After `rg -n "ensureLatestAnswerAssessment|assessAnswer|answer\.assess" lib/interview/agent --glob '!*.test.ts'` shows no runtime caller, delete the four standalone model-assessment files. Keep assessment database tables and `AnswerAssessment` contracts for persisted data; `commitTurnOutcome` now owns assessment persistence.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec tsx --test lib/interview/agent/composition.test.ts lib/interview/agent/context/assembler.test.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/repository.integration.test.ts
rg -n "ensureLatestAnswerAssessment|assessAnswer|answer\.assess" lib/interview/agent --glob '!*.test.ts' || true
npx tsc --noEmit
git add lib/interview/agent/composition.ts lib/interview/agent/composition.test.ts lib/interview/agent/context/assembler.ts lib/interview/agent/context/assembler.test.ts lib/interview/agent/repository.integration.test.ts
git add -u lib/interview/agent/assessment-service.ts lib/interview/agent/assessment-service.test.ts lib/interview/agent/assessment.ts lib/interview/agent/assessment.test.ts
git commit -m "refactor(agent): merge assessment into turn proposal"
```

Expected: tests and typecheck PASS; the search prints no remaining runtime caller.

### Task 7: Crash recovery and live contract gate

**Files:**
- Modify: `lib/interview/agent/runtime.test.ts`
- Modify: `lib/interview/agent/recovery.test.ts`
- Modify: `lib/interview/agent/worker.test.ts`
- Modify: `scripts/interview-agent-contract.ts`
- Modify: `scripts/interview-agent-failure-contract.ts`

**Interfaces:**
- Consumes all previous Runtime interfaces.
- Produces crash-boundary and real-provider acceptance coverage.

- [ ] **Step 1: Add table-driven crash recovery tests**

```ts
for (const boundary of [
  "after_tool_result",
  "after_proposal_authorized",
  "after_response_started",
  "after_response_finished",
  "after_message_committed",
] as const) {
  test(`recovers ${boundary} without duplicate writes`, async () => {
    const fixture = crashRecoveryFixture(boundary);
    await assert.rejects(runInterviewAgent(fixture.first), /injected crash/);
    await runInterviewAgent(fixture.recovered);
    assert.equal(fixture.inspect().assistantMessages.length, 1);
    assert.equal(fixture.inspect().messageCommittedEvents.length, 1);
    if (boundary === "after_response_started") {
      assert.equal(fixture.publicEventTypes().includes("response_discarded"), true);
    }
  });
}
```

Use injected repository hooks and the in-memory repository to implement `crashRecoveryFixture`.

- [ ] **Step 2: Test stale takeover during response streaming**

Worker A starts a response, loses its lease, and attempts another public delta. Worker B claims the run and completes it. Assert A's append rejects and only B commits a message.

- [ ] **Step 3: Strengthen the live contract**

```ts
const publicEvents = await dependencies.repository.listEvents(lastRun.id, 0, { visibility: "public" });
const types = publicEvents.map((event) => event.type);
assert.ok(types.includes("reasoning_delta"));
assert.ok(types.indexOf("proposal_authorized") < types.indexOf("response_started"));
assert.ok(types.indexOf("response_delta") < types.indexOf("message_committed"));
assert.equal(types.includes("text_delta"), false);
```

Also assert a controlled no-tool run records one model call.

- [ ] **Step 4: Run the full gate**

```bash
pnpm exec tsx --test lib/interview/agent/turn-proposal.test.ts lib/interview/agent/turn-authorizer.test.ts lib/interview/agent/response-validator.test.ts lib/interview/agent/model-port.test.ts lib/interview/agent/runtime.test.ts lib/interview/agent/recovery.test.ts lib/interview/agent/worker.test.ts lib/interview/agent/repository.test.ts
pnpm test
npx tsc --noEmit
pnpm lint
```

Expected: all tests PASS; typecheck and lint exit 0.

- [ ] **Step 5: Run optional live-provider gates**

```bash
pnpm test:interview:agent
pnpm test:interview:failure
```

Expected with configured credentials: both exit 0. Without credentials, record both as NOT RUN; do not weaken assertions.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/runtime.test.ts lib/interview/agent/recovery.test.ts lib/interview/agent/worker.test.ts scripts/interview-agent-contract.ts scripts/interview-agent-failure-contract.ts
git commit -m "test(agent): cover live response recovery"
```
