# Agent Assessment and Final Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-answer formal scoring with one idempotent online assessment stage and run the existing six-dimension scoring pipeline only after interview completion.

**Architecture:** Answer acceptance persists a question/message binding, then the leased Worker creates one assessment keyed by answer message ID and applies it to coverage before Agent planning. Completion creates one durable leased completion job that scores missing questions in batches of three, generates the report, and advances the interview through `scoring`, `reporting`, and `completed`.

**Tech Stack:** TypeScript strict, Drizzle ORM, PostgreSQL, Vercel AI SDK structured output, Zod, existing Agent lease/retry primitives, Node test runner via `tsx`.

## Global Constraints

- Online assessment contains no 0–10 score and never writes `question_scores`.
- Formal scoring retains Understanding, Expression, Logic, Depth, Authenticity, Reflection, and overall, each 0–10.
- Existing valid `question_scores` are reused.
- Scoring retries are per question; successful questions are never replayed because another question failed.
- A scoring failure never becomes a synthetic zero and never produces a partial report.
- Category maximum remains 3 and candidate-answer maximum remains 20.
- Update `/Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md` before implementation if this plan changes.

---

### Task 1: Persist Online Assessments and Completion Jobs

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`
- Modify: `lib/interview/agent/contracts.ts`
- Create: `lib/interview/agent/assessment-contracts.test.ts`

**Interfaces:**
- Produces: `answerAssessmentSchema` and `AnswerAssessment`.
- Produces: Drizzle tables `interviewAnswerAssessments` and `interviewCompletionJobs`.
- Adds question fields `scoreStatus`, `scoreAttemptCount`, and `scoreErrorJson`.

- [ ] **Step 1: Add failing strict contract tests**

```ts
test("accepts a bounded decision-time assessment without scores", () => {
  const result = answerAssessmentSchema.parse({
    completeness: "medium",
    specificity: "high",
    evidenceStrength: "partial",
    reflectionDepth: "surface",
    followUpNeeded: true,
    missingPoints: ["缺少量化结果"],
    extractedEvidence: ["主导智能审批项目落地"],
    publicSummary: "回答包含项目职责，但还需要补充技术取舍和结果。",
  });
  assert.equal("overall" in result, false);
});

test("rejects formal scores and unbounded assessment text", () => {
  assert.equal(answerAssessmentSchema.safeParse({
    completeness: "high", specificity: "high", evidenceStrength: "strong",
    reflectionDepth: "deep", followUpNeeded: false,
    missingPoints: [], extractedEvidence: [], publicSummary: "x".repeat(501),
    overall: 9,
  }).success, false);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm exec tsx --test lib/interview/agent/assessment-contracts.test.ts`  
Expected: FAIL because `answerAssessmentSchema` is missing.

- [ ] **Step 3: Add the Zod contract**

```ts
export const answerAssessmentSchema = z.object({
  completeness: z.enum(["low", "medium", "high"]),
  specificity: z.enum(["low", "medium", "high"]),
  evidenceStrength: z.enum(["weak", "partial", "strong"]),
  reflectionDepth: z.enum(["none", "surface", "deep"]),
  followUpNeeded: z.boolean(),
  missingPoints: z.array(z.string().min(1).max(200)).max(5),
  extractedEvidence: z.array(z.string().min(1).max(300)).max(5),
  publicSummary: z.string().min(1).max(500),
}).strict();
```

- [ ] **Step 4: Add additive schema and migration**

`interview_answer_assessments` must include UUID IDs, foreign keys to interview/question/message, unique `answer_message_id`, enum-like text fields, JSON arrays, public summary, model/token telemetry, and timestamps.

`interview_completion_jobs` must include unique `interview_id`, status, lease owner/expiry, attempt count, sanitized error JSON, and timestamps.

Question defaults:

```ts
scoreStatus: text("score_status").notNull().default("pending"),
scoreAttemptCount: integer("score_attempt_count").notNull().default(0),
scoreErrorJson: jsonb("score_error_json"),
```

- [ ] **Step 5: Run migration twice and validate contracts**

Run: `pnpm db:migrate && pnpm db:migrate && pnpm exec tsx --test lib/interview/agent/assessment-contracts.test.ts && npx tsc --noEmit`  
Expected: both migrations and tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts lib/interview/agent/contracts.ts lib/interview/agent/assessment-contracts.test.ts
git commit -m "feat(interview): persist answer assessments and completion jobs"
```

### Task 2: Add the Fast Online Assessment Model Port

**Files:**
- Modify: `lib/ai/model-policy.ts`
- Modify: `lib/ai/model-policy.test.ts`
- Create: `lib/interview/agent/assessment.ts`
- Create: `lib/interview/agent/assessment.test.ts`

**Interfaces:**
- Adds AI task `answer.assess` on the `fast` tier.
- Produces: `assessAnswer(input): Promise<AnswerAssessment>`.

- [ ] **Step 1: Add failing model-policy and prompt tests**

```ts
test("routes decision-time assessment to the fast tier", () => {
  assert.equal(getTaskTier("answer.assess"), "fast");
});

test("assessment prompt forbids scores and personality judgments", () => {
  const prompt = buildAnswerAssessmentPrompt(fixture);
  assert.match(prompt.system, /不得输出.*分数/);
  assert.match(prompt.system, /不得评价人格/);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/ai/model-policy.test.ts lib/interview/agent/assessment.test.ts`  
Expected: FAIL because the task and assessment module are missing.

- [ ] **Step 3: Register the task and implement the prompt builder**

```ts
const taskTiers: Record<AITask, AIModelTier> = {
  // existing entries
  "answer.assess": "fast",
};

export function buildAnswerAssessmentPrompt(input: AssessmentInput) {
  return {
    system: "你是面试决策辅助器。只判断回答质量和追问价值，不得输出0-10分数，不得生成正式点评，不得评价人格。",
    prompt: canonicalJson(input),
  };
}
```

- [ ] **Step 4: Implement the structured generator call**

```ts
export function assessAnswer(input: AssessmentInput, signal?: AbortSignal) {
  const prompt = buildAnswerAssessmentPrompt(input);
  return generateStructured({
    task: "answer.assess",
    schema: answerAssessmentSchema,
    system: prompt.system,
    prompt: prompt.prompt,
    abortSignal: signal,
  });
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm exec tsx --test lib/ai/model-policy.test.ts lib/interview/agent/assessment.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/model-policy.ts lib/ai/model-policy.test.ts lib/interview/agent/assessment.ts lib/interview/agent/assessment.test.ts
git commit -m "feat(interview): assess answers without formal scores"
```

### Task 3: Make Assessment Idempotent and Apply Coverage Before Planning

**Files:**
- Create: `lib/interview/agent/assessment-service.ts`
- Create: `lib/interview/agent/assessment-service.test.ts`
- Modify: `lib/interview/agent/composition.ts`
- Modify: `lib/interview/agent/context/assembler.ts`
- Modify: `lib/interview/agent/context/assembler.test.ts`

**Interfaces:**
- Produces: `ensureLatestAnswerAssessment(db, { interviewId, runId, signal }): Promise<{ assessmentId, assessment, created }>`.
- Produces: `applyAssessmentToCoverage(tx, input): Promise<void>`.
- Consumes: Task 1 assessment table and Task 2 model port.

- [ ] **Step 1: Add failing idempotency tests with an injected store/model**

```ts
test("assesses one answer once and reuses the durable result", async () => {
  const fixture = createAssessmentFixture();
  const first = await ensureLatestAnswerAssessment(fixture.dependencies);
  const second = await ensureLatestAnswerAssessment(fixture.dependencies);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(fixture.modelCalls, 1);
  assert.equal(fixture.formalScoreWrites, 0);
});

test("commits assessment and coverage in one transaction", async () => {
  const fixture = createAssessmentFixture();
  await ensureLatestAnswerAssessment(fixture.dependencies);
  assert.equal(fixture.coverage.lastAssessmentId, fixture.assessment.id);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/assessment-service.test.ts`  
Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement lookup, model call, conflict recovery, and coverage transaction**

The service must load the latest user answer with its question, return an existing assessment by `answerMessageId`, call Task 2 only when missing, insert with `onConflictDoNothing`, reload the winning row, and update coverage using that durable assessment ID.

```ts
const existing = await store.findByAnswerMessage(answer.id);
if (existing) return { assessmentId: existing.id, assessment: existing.value, created: false };
const value = await model.assess(buildInput(answer), signal);
return store.transaction(async (tx) => {
  const saved = await tx.insertOrLoad(answer.id, value);
  await applyAssessmentToCoverage(tx, { question, assessment: saved });
  return { assessmentId: saved.id, assessment: saved.value, created: saved.created };
});
```

- [ ] **Step 4: Execute assessment before context assembly for answer Runs**

```ts
if (input.mode === "answer") {
  await ensureLatestAnswerAssessment(db, {
    interviewId: input.interviewId,
    runId: input.runId,
    signal: input.signal,
  });
}
const promptContext = await loadAgentContext(db, /* existing input */);
```

- [ ] **Step 5: Add the assessment to the incremental context tail**

The assessment belongs after the cache-stable prefix because it changes each answer. Add a versioned `latest-assessment` tail segment and test that it does not alter the stable prefix.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm exec tsx --test lib/interview/agent/assessment-service.test.ts lib/interview/agent/context/assembler.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/agent/assessment-service.ts lib/interview/agent/assessment-service.test.ts lib/interview/agent/composition.ts lib/interview/agent/context/assembler.ts lib/interview/agent/context/assembler.test.ts
git commit -m "feat(interview): assess answers before agent planning"
```

### Task 4: Remove Formal Scoring from the Agent Tool Loop

**Files:**
- Modify: `lib/interview/agent/tool-registry.ts`
- Modify: `lib/interview/agent/tool-registry.test.ts`
- Modify: `lib/interview/agent/skills.ts`
- Modify: `lib/interview/agent/skills.test.ts`
- Modify: `lib/interview/agent/model-port.ts`
- Modify: `lib/interview/agent/composition.ts`

**Interfaces:**
- Removes `record_answer_evaluation` from model-visible tool names and active Skills.
- Keeps historical score reads unchanged.
- Consumes: Task 3 assessment in prompt context.

- [ ] **Step 1: Add failing tool-surface tests**

```ts
test("does not expose formal scoring during answer runs", () => {
  const active = resolveRunSkills("answer");
  assert.equal(active.toolNames.has("record_answer_evaluation"), false);
});

test("answer run instructions proceed from assessment to coverage and action", () => {
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /record_answer_evaluation/);
  assert.match(AGENT_SYSTEM_PROMPT, /已提交的轻量评估/);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/skills.test.ts lib/interview/agent/tool-registry.test.ts`  
Expected: FAIL because the scoring tool is still exposed.

- [ ] **Step 3: Remove the tool and replace the Skill**

Delete `record_answer_evaluation` from `interviewToolNames`, schemas, handlers, descriptions, and the `answer-evaluation` Skill. Add an `answer-planning` Skill whose tools are `get_interview_history`, `get_coverage_state`, `update_coverage`, `ask_interview_question`, and `finish_interview`.

- [ ] **Step 4: Update the system prompt**

```ts
const AGENT_SYSTEM_PROMPT =
  "你是 Seconda 面试 Agent。最新回答的轻量评估已经由系统提交。请基于评估、覆盖度和简历证据选择一个追问、一个新主题或结束；不得生成或写入正式分数。";
```

- [ ] **Step 5: Run Agent runtime regression tests**

Run: `pnpm exec tsx --test lib/interview/agent/skills.test.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/runtime.test.ts && pnpm test`  
Expected: PASS and no test expects formal per-turn scores.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/tool-registry.ts lib/interview/agent/tool-registry.test.ts lib/interview/agent/skills.ts lib/interview/agent/skills.test.ts lib/interview/agent/model-port.ts lib/interview/agent/composition.ts
git commit -m "refactor(interview): remove scoring from agent turns"
```

### Task 5: Make Loop Detection Phase-aware

**Files:**
- Modify: `lib/interview/agent/contracts.ts`
- Modify: `lib/interview/agent/loop-detector.ts`
- Modify: `lib/interview/agent/loop-detector.test.ts`
- Modify: `lib/interview/agent/runtime.ts`

**Interfaces:**
- Adds checkpoint phase `"assessing" | "planning" | "acting"`.
- Extends `AgentLoopDetector.record` with `phase` and `phaseProgressId`.

- [ ] **Step 1: Add failing phase reset tests**

```ts
test("a committed phase transition resets no-progress warnings", () => {
  const detector = new AgentLoopDetector();
  detector.record(call({ toolName: "get_coverage_state", phase: "planning", phaseProgressId: "a1" }));
  detector.record(call({ toolName: "get_coverage_state", phase: "planning", phaseProgressId: "a1" }));
  const decision = detector.record(call({ toolName: "ask_interview_question", phase: "acting", phaseProgressId: "a2" }));
  assert.equal(decision.level, "continue");
});

test("true repetition still warns, warns, and breaks inside one phase", () => {
  const detector = new AgentLoopDetector();
  const decisions = [1, 2, 3].map(() => detector.record(call({ phase: "planning", phaseProgressId: "a1" })));
  assert.deepEqual(decisions.map((item) => item.level), ["warning", "warning", "break"]);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/agent/loop-detector.test.ts`  
Expected: FAIL because phase fields are unsupported.

- [ ] **Step 3: Implement phase-aware counters**

Reset generic no-progress, repeated-error, and ping-pong windows when `phaseProgressId` changes. Preserve global tool-call and model-turn caps across phases.

```ts
if (record.phaseProgressId !== this.phaseProgressId) {
  this.resetLocalWindows();
  this.phaseProgressId = record.phaseProgressId;
}
```

- [ ] **Step 4: Persist the phase in checkpoints and pass it from runtime calls**

```ts
await repository.saveCheckpoint(runId, {
  ...checkpoint,
  phase,
  phaseProgressId: assessmentId,
});
```

- [ ] **Step 5: Run detector and runtime tests**

Run: `pnpm exec tsx --test lib/interview/agent/loop-detector.test.ts lib/interview/agent/runtime.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/agent/contracts.ts lib/interview/agent/loop-detector.ts lib/interview/agent/loop-detector.test.ts lib/interview/agent/runtime.ts
git commit -m "fix(interview): scope loop warnings to agent phases"
```

### Task 6: Build a Durable Completion Worker

**Files:**
- Create: `lib/interview/completion/repository.ts`
- Create: `lib/interview/completion/repository.test.ts`
- Create: `lib/interview/completion/worker.ts`
- Create: `lib/interview/completion/worker.test.ts`
- Modify: `lib/interview/report-completion.ts`
- Modify: `lib/interview/agent/composition.ts`
- Modify: `lib/interview/agent/service.ts`
- Modify: `app/api/interviews/[id]/end/route.ts`
- Create: `app/api/interviews/[id]/completion/resume/route.ts`

**Interfaces:**
- Produces: `createCompletionJob(interviewId): Promise<{ id, created }>`.
- Produces: `claimCompletionJob`, `renewCompletionLease`, and `executeCompletionJob`.
- Produces: `scheduleInterviewCompletion(interviewId)` used by Agent finish and user end.
- Produces: authenticated stale-job recovery endpoint `POST /api/interviews/:id/completion/resume`.

- [ ] **Step 1: Add failing lease/idempotency tests**

```ts
test("creates one completion job per interview", async () => {
  const repository = createInMemoryCompletionRepository();
  const first = await repository.createJob("interview");
  const second = await repository.createJob("interview");
  assert.equal(first.id, second.id);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
});

test("only one worker claims a completion job", async () => {
  const repository = createInMemoryCompletionRepository();
  const job = await repository.createJob("interview");
  const claims = await Promise.all([
    repository.claim(job.id, "a", new Date(), 30_000),
    repository.claim(job.id, "b", new Date(), 30_000),
  ]);
  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
});

test("a stale completion lease can be reclaimed", async () => {
  const repository = createInMemoryCompletionRepository();
  const job = await repository.createJob("interview");
  await repository.claim(job.id, "old", new Date(0), 1_000);
  const recovered = await repository.claim(job.id, "new", new Date(2_000), 30_000);
  assert.equal(recovered.claimed, true);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/completion/repository.test.ts lib/interview/completion/worker.test.ts`  
Expected: FAIL because completion modules are missing.

- [ ] **Step 3: Implement completion repository and leased Worker**

Reuse the Agent lease semantics with a unique interview job. The Worker transitions the interview to `scoring`, calls Task 7 scoring, transitions to `reporting`, generates the report, and commits `completed`. A stale lease can be reclaimed.

- [ ] **Step 4: Replace synchronous report generation at finish call sites**

```ts
await scheduleInterviewCompletion(context.interviewId);
await repository.appendMessage({
  interviewId: context.interviewId,
  runId: context.runId,
  role: "assistant",
  kind: "finish",
  content: input.closingMessage,
});
```

The `/end` route returns accepted state without waiting for scoring:

```ts
return NextResponse.json({ status: "scoring", completionJobId }, { status: 202 });
```

Scheduling may use Next.js `after()` for the first attempt, but durable recovery must not depend on that callback surviving process shutdown. Add an authenticated resume route that loads the interview's completion job, returns terminal status when finished, returns `already_running` for a live lease, and schedules claim when the lease is absent or expired:

```ts
const disposition = getCompletionRecoveryDisposition(job, new Date());
if (disposition === "schedule") await scheduler.schedule(job.id);
return NextResponse.json({ jobId: job.id, disposition }, { status: 202 });
```

The room recovery flow calls this endpoint when it observes `scoring` or `reporting` without a live completion lease.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm exec tsx --test lib/interview/completion/*.test.ts lib/interview/agent/service.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/interview/completion lib/interview/report-completion.ts lib/interview/agent/composition.ts lib/interview/agent/service.ts 'app/api/interviews/[id]/end/route.ts' 'app/api/interviews/[id]/completion/resume/route.ts'
git commit -m "feat(interview): schedule durable completion jobs"
```

### Task 7: Score Missing Questions in Bounded Batches, Then Report

**Files:**
- Create: `lib/interview/completion/scoring.ts`
- Create: `lib/interview/completion/scoring.test.ts`
- Modify: `lib/interview/completion/worker.ts`
- Modify: `lib/interview/report-completion.ts`
- Modify: `app/api/interviews/[id]/route.ts`

**Interfaces:**
- Produces: `scorePendingQuestions(db, interviewId, { concurrency: 3, signal }): Promise<ScoringSummary>`.
- Consumes: existing `scoreInterviewAnswer` and Task 6 completion Worker.

- [ ] **Step 1: Add failing batch/idempotency tests**

```ts
test("scores only missing questions with at most three concurrent calls", async () => {
  const fixture = createScoringFixture({ answered: 7, alreadyScored: [1, 3] });
  const summary = await scorePendingQuestions(fixture.dependencies, { concurrency: 3 });
  assert.deepEqual(fixture.scoredQuestionIndexes.sort(), [2, 4, 5, 6, 7]);
  assert.ok(fixture.maxConcurrency <= 3);
  assert.equal(summary.scored, 7);
});

test("does not write zero or start a report after exhausted scoring failure", async () => {
  const fixture = createScoringFixture({ answered: 2, permanentlyFail: [2] });
  await assert.rejects(scorePendingQuestions(fixture.dependencies, { concurrency: 3 }));
  assert.equal(fixture.reportCalls, 0);
  assert.equal(fixture.scores.get(2), undefined);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec tsx --test lib/interview/completion/scoring.test.ts`  
Expected: FAIL because scoring orchestration is missing.

- [ ] **Step 3: Implement atomic per-question claims and bounded workers**

Claim a question by changing `pending` or retryable `failed` to `scoring` and incrementing attempts. On success, write score/feedback and `scored` in one transaction. On error, save sanitized error and either return to `pending` or mark terminal `failed` after the configured budget.

```ts
await mapWithConcurrency(pending, 3, async (question) => {
  const claimed = await repository.claimQuestion(question.id);
  if (!claimed) return;
  const result = await scoreInterviewAnswer(buildScoreInput(claimed), signal);
  await repository.commitScore(claimed.id, result);
});
```

- [ ] **Step 4: Generate the report only after successful scoring summary**

```ts
const summary = await scorePendingQuestions(db, interviewId, { concurrency: 3, signal });
if (summary.failed > 0) throw new CompletionBlockedError("SCORING_INCOMPLETE");
await markInterviewReporting(db, interviewId);
await completeInterviewReport(db, interviewId);
```

- [ ] **Step 5: Expose progress in interview details**

Return `{ total, pending, scoring, scored, failed }` and interview status so UI Plan 3 can render real progress.

- [ ] **Step 6: Run migrations, all tests, lint, and build**

Run: `pnpm db:migrate && pnpm db:migrate && pnpm test && npx tsc --noEmit && pnpm lint && pnpm build`  
Expected: all pass; lint retains at most the two pre-existing warnings.

- [ ] **Step 7: Commit**

```bash
git add lib/interview/completion/scoring.ts lib/interview/completion/scoring.test.ts lib/interview/completion/worker.ts lib/interview/report-completion.ts 'app/api/interviews/[id]/route.ts'
git commit -m "feat(interview): score answers after completion"
```

## Plan Acceptance Gate

- During an active interview, querying `question_scores` returns no newly generated formal scores.
- Replaying one answer Run produces one assessment model call and one assessment row.
- Agent planning receives the assessment and can still follow up adaptively.
- User or Agent completion returns promptly with `scoring` state.
- Completion scores missing questions in batches no larger than three, reuses existing scores, and generates exactly one report.
- A permanently failed score produces an explicit failed completion state, not zero and not a partial report.
