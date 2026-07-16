# Agent Coverage Repair Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent answer-turn Runs from exhausting terminal repairs when `assessment.followUpNeeded` and `coverageChanges.status` disagree by aligning the provider contract and returning actionable deterministic repair details.

**Architecture:** Keep `authorizeTurnProposal` as the single deterministic authority. Enrich only `CONTRADICTORY_COVERAGE_CHANGE` rejections with a typed, sanitized conflict detail; expose the same invariant in the provider JSON Schema, system Prompt, and answer-planning Skill; then let Runtime translate the detail into a bounded terminal repair instruction. No rule is relaxed and no database or public event shape changes.

**Tech Stack:** TypeScript strict mode, Zod 4, Vercel AI SDK 7, Node test runner through `tsx --test`, in-memory Agent repository, Next.js 16.

## Global Constraints

- Read and follow `/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md` and repository `AGENTS.md`.
- Preserve six-dimension scoring, equal weighting, service-side aggregation, and post-interview scoring timing.
- Preserve the deterministic mapping `followUpNeeded=true -> partial`, `followUpNeeded=false -> sufficient`, and category question count `>= 3 -> exhausted`.
- Preserve the maximum of 3 questions per category, 20 candidate-answer rounds, existing completion conditions, and resume snapshot grounding.
- Preserve three terminal attempts, terminal-only repair mode, authorization-before-response, provisional discard behavior, and the current candidate-facing terminal failure message.
- Do not add database migrations, model calls, public event fields, front-end behavior, or replay/mutation of historical failed Runs.

---

## File Structure

- `lib/interview/agent/turn-authorizer.ts`: define sanitized coverage conflict details and produce them while projecting deterministic coverage state.
- `lib/interview/agent/turn-authorizer.test.ts`: specify every conflict kind and preserve successful authorization behavior.
- `lib/interview/agent/turn-proposal.ts`: expose model-visible descriptions for assessment/coverage invariants.
- `lib/interview/agent/tool-registry.test.ts`: verify the provider JSON Schema carries those descriptions.
- `lib/interview/agent/model-port.ts`: add the invariant to the global Agent Prompt.
- `lib/interview/agent/model-port.test.ts`: protect the global Prompt contract.
- `lib/interview/agent/skills.ts`: add the invariant to answer-turn planning instructions.
- `lib/interview/agent/skills.test.ts`: protect the Skill contract.
- `lib/interview/agent/runtime.ts`: carry conflict details through `AttemptFailure` and render actionable repair guidance.
- `lib/interview/agent/runtime.test.ts`: reproduce the introduction-answer failure and prove one repaired proposal commits exactly once.

---

### Task 1: Return typed coverage conflict details from deterministic authorization

**Files:**
- Modify: `lib/interview/agent/turn-authorizer.ts:1-245`
- Modify: `lib/interview/agent/turn-authorizer.test.ts:1-330`

**Interfaces:**
- Consumes: `QuestionCategory`, `CoverageStatus`, `TurnProposalPrefix`, `InterviewAgentState`.
- Produces: exported `CoverageConflictDetail` and a `detail` property on `CONTRADICTORY_COVERAGE_CHANGE` rejections.

- [ ] **Step 1: Replace generic contradictory-coverage assertions with detailed failing assertions**

Update `turn-authorizer.test.ts` so the current-category assessment mismatch asserts the exact detail:

```ts
test("describes an assessment coverage status mismatch", () => {
  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({
      categoryCounts: { introduction: 1 },
      categoryStatuses: { introduction: "partial" },
    }),
    mode: "answer",
    answerCategory: "introduction",
    prefix: askPrefix({
      assessment: validAssessment({ followUpNeeded: false }),
      coverageChanges: [{
        category: "introduction",
        topic: "自我介绍",
        status: "partial",
        resumeEvidenceIds: ["evidence-1"],
      }],
    }),
  }), {
    allowed: false,
    reason: "CONTRADICTORY_COVERAGE_CHANGE",
    detail: {
      category: "introduction",
      topic: "自我介绍",
      receivedStatus: "partial",
      expectedStatuses: ["sufficient"],
      conflictKind: "assessment_status_mismatch",
    },
  });
});
```

Add focused tests for premature exhaustion and a non-answer category change:

```ts
test("describes premature category exhaustion", () => {
  const result = authorizeTurnProposal({
    state: stateWith({ categoryCounts: { technical_depth: 2 } }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: askPrefix({
      assessment: validAssessment({ followUpNeeded: true }),
      coverageChanges: [{
        category: "technical_depth",
        topic: "降级机制",
        status: "exhausted",
        resumeEvidenceIds: ["evidence-1"],
      }],
    }),
  });

  assert.deepEqual(result, {
    allowed: false,
    reason: "CONTRADICTORY_COVERAGE_CHANGE",
    detail: {
      category: "technical_depth",
      topic: "降级机制",
      receivedStatus: "exhausted",
      expectedStatuses: ["partial"],
      conflictKind: "premature_exhausted",
    },
  });
});

test("describes a non-answer category status change", () => {
  const result = authorizeTurnProposal({
    state: stateWith({
      categoryStatuses: {
        technical_depth: "partial",
        introduction: "uncovered",
      },
    }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: askPrefix({
      coverageChanges: [{
        category: "introduction",
        topic: "自我介绍",
        status: "partial",
        resumeEvidenceIds: ["evidence-1"],
      }],
    }),
  });

  assert.deepEqual(result, {
    allowed: false,
    reason: "CONTRADICTORY_COVERAGE_CHANGE",
    detail: {
      category: "introduction",
      topic: "自我介绍",
      receivedStatus: "partial",
      expectedStatuses: ["uncovered"],
      conflictKind: "non_answer_category_change",
    },
  });
});
```

Update older deep-equality assertions for contradictory coverage to include the matching detail instead of weakening them to `result.allowed === false`.

- [ ] **Step 2: Run the focused authorization tests and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/turn-authorizer.test.ts
```

Expected: FAIL because rejected proposals expose only `reason` and do not include `detail`.

- [ ] **Step 3: Add the conflict type and propagate it from projection**

In `turn-authorizer.ts`, export:

```ts
export type CoverageConflictDetail = {
  category: QuestionCategory;
  topic: string;
  receivedStatus: CoverageStatus;
  expectedStatuses: CoverageStatus[];
  conflictKind:
    | "assessment_status_mismatch"
    | "premature_exhausted"
    | "non_answer_category_change";
};
```

Make `RejectedTurnProposal` a discriminated union so only the coverage rejection requires details:

```ts
type NonCoverageRejectionReason = Exclude<
  | "OPENING_ASSESSMENT_FORBIDDEN"
  | "OPENING_COVERAGE_FORBIDDEN"
  | "ANSWER_ASSESSMENT_REQUIRED"
  | "ANSWER_CATEGORY_REQUIRED"
  | "CONTRADICTORY_COVERAGE_CHANGE"
  | "INVALID_PROPOSAL"
  | "CATEGORY_LIMIT"
  | "DUPLICATE_QUESTION"
  | "MISSING_EVIDENCE"
  | "INVALID_FINISH_REASON"
  | "OPENING_CANNOT_FINISH"
  | "COMPLETION_NOT_READY"
  | "POLICY_REQUIRES_FINISH"
  | "INVALID_ACTION",
  "CONTRADICTORY_COVERAGE_CHANGE"
>;

export type RejectedTurnProposal =
  | {
      allowed: false;
      reason: "CONTRADICTORY_COVERAGE_CHANGE";
      detail: CoverageConflictDetail;
    }
  | {
      allowed: false;
      reason: NonCoverageRejectionReason;
    };
```

Change `projectTurnState` failure output to carry the conflict:

```ts
} | { ok: false; detail: CoverageConflictDetail } {
```

Create the detail at each rejection boundary, preserving this precedence:

```ts
if (change.status === "exhausted" && !categoryIsExhausted) {
  return {
    ok: false,
    detail: {
      category: change.category,
      topic: change.topic,
      receivedStatus: change.status,
      expectedStatuses: change.category === input.answerCategory && assessmentStatus
        ? [assessmentStatus]
        : [categoryStatuses[change.category] ?? "uncovered"],
      conflictKind: "premature_exhausted",
    },
  };
}
```

For a current answer-category mismatch, return `assessment_status_mismatch` with `[assessmentStatus]`. For another category whose status differs from the projected status, return `non_answer_category_change` with `[projectedStatus]`.

Propagate the detail from `authorizeTurnProposal`:

```ts
if (!projectedStateResult.ok) {
  return {
    allowed: false,
    reason: "CONTRADICTORY_COVERAGE_CHANGE",
    detail: projectedStateResult.detail,
  };
}
```

- [ ] **Step 4: Run authorization tests and typecheck**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/turn-authorizer.test.ts
npx tsc --noEmit
```

Expected: both commands PASS; no non-coverage rejection is forced to fabricate conflict details.

- [ ] **Step 5: Commit the deterministic authorization change**

```bash
git add lib/interview/agent/turn-authorizer.ts lib/interview/agent/turn-authorizer.test.ts
git commit -m "fix(agent): describe coverage authorization conflicts"
```

---

### Task 2: Align the provider Schema, system Prompt, and answer-planning Skill

**Files:**
- Modify: `lib/interview/agent/turn-proposal.ts:1-75`
- Modify: `lib/interview/agent/tool-registry.test.ts:60-95`
- Modify: `lib/interview/agent/model-port.ts:760-770`
- Modify: `lib/interview/agent/model-port.test.ts:25-65`
- Modify: `lib/interview/agent/skills.ts:20-36`
- Modify: `lib/interview/agent/skills.test.ts:12-30`

**Interfaces:**
- Consumes: the unchanged `interviewTurnProposalSchema` provider tool input.
- Produces: exported description constants and identical coverage invariants across JSON Schema, global Prompt, and answer-planning Skill.

- [ ] **Step 1: Add failing contract assertions**

In `tool-registry.test.ts`, expand the JSON Schema shape and assert model-visible descriptions:

```ts
const schema = z.toJSONSchema(
  interviewToolInputSchemas.submit_interview_turn,
) as {
  properties?: {
    assessment?: { description?: string };
    coverageChanges?: {
      description?: string;
      items?: {
        properties?: { status?: { description?: string } };
      };
    };
    responseText?: { description?: string };
  };
};

assert.match(schema.properties?.assessment?.description ?? "", /followUpNeeded=true.*partial/);
assert.match(schema.properties?.assessment?.description ?? "", /followUpNeeded=false.*sufficient/);
assert.match(schema.properties?.coverageChanges?.description ?? "", /当前回答分类/);
assert.match(
  schema.properties?.coverageChanges?.items?.properties?.status?.description ?? "",
  /第 3 题.*exhausted/,
);
```

In `model-port.test.ts`, add:

```ts
assert.match(AGENT_SYSTEM_PROMPT, /followUpNeeded=true.*partial/);
assert.match(AGENT_SYSTEM_PROMPT, /followUpNeeded=false.*sufficient/);
assert.match(AGENT_SYSTEM_PROMPT, /第 3 题.*exhausted/);
assert.match(AGENT_SYSTEM_PROMPT, /通常只为当前回答分类提交 coverageChanges/);
```

In `skills.test.ts`, extend the answer-planning test:

```ts
const answerPlanning = resolveRunSkills("answer").skills.find(
  (skill) => skill.name === "answer-planning",
);
assert.match(answerPlanning?.instructions ?? "", /followUpNeeded=true.*partial/);
assert.match(answerPlanning?.instructions ?? "", /followUpNeeded=false.*sufficient/);
assert.match(answerPlanning?.instructions ?? "", /第 3 题.*exhausted/);
```

- [ ] **Step 2: Run the provider-contract tests and verify failure**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.test.ts lib/interview/agent/skills.test.ts
```

Expected: FAIL because the coverage mapping is absent from all three model-visible surfaces.

- [ ] **Step 3: Add explicit proposal Schema descriptions**

In `turn-proposal.ts`, add and export these constants:

```ts
export const ANSWER_ASSESSMENT_SCHEMA_DESCRIPTION =
  "回答轮必须提交轻量评估；followUpNeeded=true 时当前回答分类的覆盖状态为 partial，followUpNeeded=false 时为 sufficient；开场必须为 null。";

export const COVERAGE_CHANGES_SCHEMA_DESCRIPTION =
  "通常只为当前回答分类提交主题覆盖变化；状态必须与 assessment.followUpNeeded 推导结果一致，其他分类不得改变聚合状态。";

export const COVERAGE_STATUS_SCHEMA_DESCRIPTION =
  "当前回答分类：followUpNeeded=true 使用 partial，false 使用 sufficient；该分类达到第 3 题时使用 exhausted，未达到时不得提前使用 exhausted。";
```

Create model-facing variants without changing parsed output types:

```ts
const turnAnswerAssessmentSchema = answerAssessmentSchema.describe(
  ANSWER_ASSESSMENT_SCHEMA_DESCRIPTION,
);

const turnCoverageStatusSchema = coverageStatusSchema.describe(
  COVERAGE_STATUS_SCHEMA_DESCRIPTION,
);
```

Use `turnCoverageStatusSchema` for `coverageChangeSchema.status`, describe `assessment`, and describe the `coverageChanges` array:

```ts
status: turnCoverageStatusSchema,

assessment: turnAnswerAssessmentSchema
  .nullable()
  .describe(ANSWER_ASSESSMENT_SCHEMA_DESCRIPTION),
coverageChanges: z.array(coverageChangeSchema)
  .max(9)
  .describe(COVERAGE_CHANGES_SCHEMA_DESCRIPTION),
```

- [ ] **Step 4: Add the same invariant to the system Prompt and Skill**

Append this contract to `AGENT_SYSTEM_PROMPT` before the opening instructions:

```text
回答轮的当前回答分类状态必须与轻量评估一致：followUpNeeded=true 使用 partial，followUpNeeded=false 使用 sufficient；当前回答分类达到第 3 题时使用 exhausted，未达到时不得提前 exhausted。通常只为当前回答分类提交 coverageChanges，其他分类不得改变聚合状态。
```

Add the same concise mapping to the `answer-planning` Skill instructions:

```text
当前回答分类的 coverageChanges 状态必须与 assessment 一致：followUpNeeded=true 使用 partial，false 使用 sufficient；该分类达到第 3 题时使用 exhausted。通常只提交当前回答分类的变化，不得改变其他分类聚合状态。
```

- [ ] **Step 5: Run provider-contract tests and typecheck**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.test.ts lib/interview/agent/skills.test.ts
npx tsc --noEmit
```

Expected: PASS. Existing assertions that `responseText` remains last and opening assessment/coverage rules remain unchanged also pass.

- [ ] **Step 6: Commit the model-visible contract**

```bash
git add lib/interview/agent/turn-proposal.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.ts lib/interview/agent/model-port.test.ts lib/interview/agent/skills.ts lib/interview/agent/skills.test.ts
git commit -m "fix(agent): align coverage generation contract"
```

---

### Task 3: Feed actionable coverage details into bounded Runtime repair

**Files:**
- Modify: `lib/interview/agent/runtime.ts:335-365,1020-1185`
- Modify: `lib/interview/agent/runtime.test.ts:40-180,413-480,1120-1260`

**Interfaces:**
- Consumes: `CoverageConflictDetail` from Task 1 and existing `TurnProposalAuthorization`.
- Produces: detailed internal repair instructions while preserving `AttemptFailure.code`, terminal attempt accounting, and public discard payloads.

- [ ] **Step 1: Add an answer-turn proposal fixture and seed support**

Import `QuestionCategory` and add this helper to `runtime.test.ts`:

```ts
function answerProposal(input: {
  followUpNeeded: boolean;
  status: "partial" | "sufficient" | "exhausted";
}): InterviewTurnProposal {
  return {
    assessment: {
      completeness: "high",
      specificity: "medium",
      evidenceStrength: "strong",
      reflectionDepth: "surface",
      followUpNeeded: input.followUpNeeded,
      missingPoints: [],
      extractedEvidence: ["候选人介绍了近期经历和技术方向"],
      publicSummary: "回答提供了近期经历和技术方向。",
    },
    coverageChanges: [{
      category: "introduction",
      topic: "自我介绍",
      status: input.status,
      resumeEvidenceIds: ["resume:profile"],
    }],
    decision: {
      action: "ask",
      category: "resume_project",
      intent: "new_topic",
      evidenceIds: ["resume:project"],
      coverageTarget: "项目职责与关键取舍",
      estimatedInformationGain: "high",
    },
    responseText: "请选择一个近期项目，说明你的职责和关键技术取舍。",
  };
}
```

Extend `createRuntimeFixture` options with `answerCategory?: QuestionCategory`. When present, seed one committed question and candidate answer before running the Agent:

```ts
let answerMessageId: string | null = null;
if (options?.answerCategory) {
  const asked = await repository.commitQuestionOutcome({
    runId: run.id,
    interviewId: "interview",
    toolCallId: "seed-question",
    lease,
    category: options.answerCategory,
    topic: "自我介绍",
    question: "请介绍一下自己。",
    responseText: "请介绍一下自己。",
    resumeEvidenceIds: ["resume:profile"],
  });
  const answer = await repository.appendMessage({
    interviewId: "interview",
    runId: run.id,
    role: "user",
    kind: "answer",
    content: "我介绍了近期经历和技术方向。",
    questionId: asked.questionId,
  });
  answerMessageId = answer.id;
}
```

Build `turnContext` from that option:

```ts
turnContext: {
  mode: options?.answerCategory ? "answer" as const : "opening" as const,
  answerCategory: options?.answerCategory ?? null,
  answerMessageId,
  language: "zh" as const,
  persona: "standard" as const,
  allowedTerms: options?.allowedTerms ?? ["回退机制", "项目经历"],
},
```

- [ ] **Step 2: Add the failing Runtime repair regression**

Add:

```ts
test("repairs an introduction coverage mismatch with expected and received statuses", async () => {
  let repairInstruction = "";
  const repaired: StreamScript = async (input, callNumber) => {
    repairInstruction = input.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    return streamingTerminalScript({
      proposal: answerProposal({
        followUpNeeded: false,
        status: "sufficient",
      }),
    })(input, callNumber);
  };
  const fixture = await createRuntimeFixture({
    answerCategory: "introduction",
    initialState: {
      interviewId: "interview",
      candidateRoundCount: 1,
      categoryCounts: {},
      categoryStatuses: {},
      recentQuestions: [],
      requestedUserEnd: false,
      consecutiveNoFollowUpAssessments: 0,
    },
    allowedTerms: ["项目", "职责", "技术", "取舍", "近期经历", "技术方向"],
    model: scriptedModel([
      streamingTerminalScript({
        proposal: answerProposal({
          followUpNeeded: false,
          status: "partial",
        }),
      }),
      repaired,
    ]),
  });

  const result = await runInterviewAgent(fixture.runOptions);

  assert.equal(result.exitReason, "completed");
  assert.match(repairInstruction, /introduction/);
  assert.match(repairInstruction, /自我介绍/);
  assert.match(repairInstruction, /应为 sufficient/);
  assert.match(repairInstruction, /不能为 partial/);
  assert.match(repairInstruction, /followUpNeeded=false.*sufficient/);
  const snapshot = fixture.repository.inspectInterview("interview");
  assert.equal(snapshot.assessments.length, 1);
  assert.equal(snapshot.messages.filter((message) => message.role === "assistant").length, 2);
  assert.equal(
    (await fixture.publicEvents()).filter((event) => event.type === "message_committed").length,
    1,
  );
});
```

- [ ] **Step 3: Run the Runtime regression and verify failure**

Run:

```bash
pnpm exec tsx --test --test-name-pattern="repairs an introduction coverage mismatch" lib/interview/agent/runtime.test.ts
```

Expected: FAIL because the repair instruction contains only the generic “根据失败代码修正结构化行动” guidance.

- [ ] **Step 4: Carry conflict details through `AttemptFailure`**

Import the type:

```ts
import type { CoverageConflictDetail } from "./turn-authorizer";
```

Extend `AttemptFailure`:

```ts
class AttemptFailure extends Error {
  readonly code: string;
  readonly coverageConflict?: CoverageConflictDetail;

  constructor(
    code: string,
    message: string,
    options?: { coverageConflict?: CoverageConflictDetail },
  ) {
    super(message);
    this.name = "AttemptFailure";
    this.code = code;
    this.coverageConflict = options?.coverageConflict;
  }
}
```

At the authorization rejection boundary, preserve the detail only for the coverage rejection:

```ts
if (!authorization.allowed) {
  throw new AttemptFailure(
    authorization.reason,
    `提案未通过确定性授权：${authorization.reason}`,
    authorization.reason === "CONTRADICTORY_COVERAGE_CHANGE"
      ? { coverageConflict: authorization.detail }
      : undefined,
  );
}
```

- [ ] **Step 5: Render specific and fallback repair guidance**

Add a fixed invariant and renderer near `repairGuidance`:

```ts
const coverageStatusRepairRule =
  "followUpNeeded=false 时使用 sufficient，true 时使用 partial；分类达到第 3 题时使用 exhausted，未达到时不得提前 exhausted。";

function coverageRepairGuidance(detail?: CoverageConflictDetail) {
  if (!detail) {
    return `修正 coverageChanges 状态。${coverageStatusRepairRule}`;
  }
  const expected = detail.expectedStatuses.join(" 或 ");
  return `coverageChanges 中分类 ${detail.category}、主题“${detail.topic}”的状态应为 ${expected}，不能为 ${detail.receivedStatus}。${coverageStatusRepairRule}`;
}
```

Use it before the generic fallback:

```ts
if (code === "CONTRADICTORY_COVERAGE_CHANGE") {
  return coverageRepairGuidance(
    findErrorInstance(error, AttemptFailure)?.coverageConflict,
  );
}
```

The helper must not serialize the proposal or change error codes, discard reasons, attempt counters, or public event payloads.

- [ ] **Step 6: Run the Runtime test matrix**

Run:

```bash
pnpm exec tsx --test lib/interview/agent/runtime.test.ts lib/interview/agent/turn-authorizer.test.ts
npx tsc --noEmit
```

Expected: PASS, including existing terminal exhaustion, terminal-only repair, response authorization, recovery, and public payload tests.

- [ ] **Step 7: Commit the Runtime repair change**

```bash
git add lib/interview/agent/runtime.ts lib/interview/agent/runtime.test.ts
git commit -m "fix(agent): guide coverage proposal repairs"
```

---

### Task 4: Run complete validation and inspect the final diff

**Files:**
- Verify: all files modified in Tasks 1-3
- Modify only if a validation command identifies a defect within this design.

**Interfaces:**
- Consumes: completed deterministic authorization, provider contract, and Runtime repair behavior.
- Produces: a release-ready, fully validated fix with no unrelated changes.

- [ ] **Step 1: Run focused tests**

```bash
pnpm exec tsx --test lib/interview/agent/turn-proposal.test.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/model-port.test.ts lib/interview/agent/skills.test.ts lib/interview/agent/turn-authorizer.test.ts lib/interview/agent/runtime.test.ts
```

Expected: PASS with no skipped or cancelled tests.

- [ ] **Step 2: Run the complete repository test suite**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run static validation**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: both commands exit 0 with no new errors.

- [ ] **Step 4: Run the production build**

```bash
pnpm build
```

Expected: Next.js production build exits 0. Startup configuration validation may use the existing `.env`; no live provider call is required.

- [ ] **Step 5: Inspect scope and whitespace**

```bash
git status --short
git diff --check HEAD~3..HEAD
git diff --stat HEAD~3..HEAD
git log -4 --oneline
```

Expected: only the approved Agent contract, authorization, Runtime, tests, design, and plan files are present; whitespace validation exits 0.

- [ ] **Step 6: Review against the approved design**

Confirm all seven acceptance criteria in `docs/superpowers/specs/2026-07-16-agent-coverage-repair-contract-design.md` are covered by code or tests. Do not replay or rewrite Run `a1c8b09a-cd12-4d4d-82ad-159a34bfe83c`; a user retry must create a fresh Run after the fix.

