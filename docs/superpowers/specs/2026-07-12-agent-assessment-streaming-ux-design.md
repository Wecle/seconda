# Seconda Agent Assessment, Streaming, and Thinking UX Design

**Date:** 2026-07-12
**Status:** Proposed
**Audience:** Seconda product and engineering
**Scope:** Agent interview answer processing, final scoring, Run/SSE lifecycle, thinking UX, committed status cards, and message ordering

## 1. Problem Statement

The current Agent interview performs a full six-dimension score after every candidate answer. This creates unnecessary latency and model cost, makes the tool loop longer, and caused a real failure mode: `record_answer_evaluation` returned `alreadyRecorded`, the Agent repeated it, the no-progress detector accumulated warnings, and the Run exited with `blocking_limit`.

The failed Run exposed three additional lifecycle bugs:

1. Failure changed the Run row to `failed` but did not persist a `run_failed` terminal event.
2. The SSE response closed without a terminal event, so native `EventSource` treated it as a network interruption and reconnected indefinitely.
3. The polling wait added an `abort` listener every cycle and did not remove it after a normal timeout, producing `MaxListenersExceededWarning`.

The UI also renders the interviewer-thinking indicator before the newly submitted candidate message appears, and it cannot show durable background actions such as evidence linkage or coverage updates.

## 2. Goals

- Preserve adaptive follow-up decisions without generating formal scores during the interview.
- Generate the existing six-dimension scores only after interview completion.
- Guarantee an explicit terminal event for every Run exit path.
- Eliminate listener leaks and infinite SSE reconnect loops.
- Render the candidate message before any interviewer-thinking state.
- Show safe, public thinking summaries and committed background-result cards.
- Keep provisional output separate from committed transcript messages.
- Preserve the category limit of 3, global limit of 20 candidate-answer rounds, resume grounding, and user-requested completion.

## 3. Non-Goals

- Exposing raw provider chain-of-thought, hidden reasoning tokens, or private internal prompts.
- Changing the six scoring dimensions or their 0–10 ranges.
- Showing per-question scores before the interview ends.
- Adding voice interviews, multi-user collaboration, or a general-purpose workflow canvas.
- Treating a network connection as the source of truth for Run state.

## 4. Key Decisions

### 4.1 Two-stage evaluation

Candidate answers use two distinct evaluation layers:

1. **Online assessment:** a compact, internal quality signal used only for coverage and follow-up decisions.
2. **Final scoring:** the existing formal six-dimension score, feedback, and deep-dive data generated after completion.

Online assessment never writes `question_scores` and is never shown as a formal score.

### 4.2 Online assessment is an orchestrated stage, not a repeatable Agent tool

The Worker performs the online assessment once before entering the model tool loop. It is keyed by the durable answer message ID and protected by a unique constraint. The Agent receives the committed assessment in context.

This is preferred over adding another model-visible `assess_answer_quality` tool because a model-visible tool can be called repeatedly and recreate the same loop failure.

### 4.3 Public thinking, not raw reasoning

The UI may display:

- structured public progress summaries explicitly generated for display;
- real tool lifecycle states;
- committed domain results.

The UI must not display raw chain-of-thought or blindly forward provider reasoning fields. A provider with a thinking mode may activate the thinking UI, but content must still come from the public-summary channel.

### 4.4 Run state is durable; SSE is delivery only

The database Run, event log, committed messages, assessment records, and report jobs are authoritative. SSE reconnects replay durable events and may be replaced without changing domain state.

## 5. Target State Machine

### 5.1 Interview state

```text
active
  -> scoring       user ends, Agent ends, or 20-round limit reached
  -> failed        unrecoverable interview-level failure

scoring
  -> reporting     all answer scores are complete
  -> failed        scoring retry budget exhausted

reporting
  -> completed     reportJson and overallScore are committed
  -> failed        report retry budget exhausted
```

`completed` is written only after the report is durable.

### 5.2 Answer Run phases

```text
accepted
  -> assessing
  -> planning
  -> acting
  -> completed | failed
```

The phase is persisted in the Run checkpoint. Recovery resumes from the first incomplete phase.

### 5.3 Scoring item state

```text
pending -> scoring -> scored
                   -> failed -> pending (bounded retry)
```

Each question is independently idempotent.

## 6. Online Answer Assessment

### 6.1 Contract

```ts
type AnswerAssessment = {
  completeness: "low" | "medium" | "high";
  specificity: "low" | "medium" | "high";
  evidenceStrength: "weak" | "partial" | "strong";
  reflectionDepth: "none" | "surface" | "deep";
  followUpNeeded: boolean;
  missingPoints: string[];
  extractedEvidence: string[];
  publicSummary: string;
};
```

All strings are bounded. `publicSummary` is concise, factual, and safe to expose as a thinking summary. It cannot contain a score or personality judgment.

### 6.2 Persistence

Add `interview_answer_assessments` with:

- `id`
- `interview_id`
- `question_id`
- `answer_message_id`
- assessment enum fields
- bounded JSON arrays for missing points and extracted evidence
- `public_summary`
- model and token telemetry
- timestamps

`answer_message_id` is unique. Reprocessing the same answer returns the existing assessment without another model call.

### 6.3 Coverage update

The orchestrator applies the assessment to coverage before Agent planning. Coverage stores:

- category and topic;
- question count;
- depth;
- evidence quality;
- status;
- last assessment ID.

The deterministic policy still authorizes the next action. The model cannot exceed category or global limits.

## 7. Final Scoring and Report Pipeline

### 7.1 Completion trigger

Completion may be triggered by:

- explicit user action;
- Agent proposal approved by deterministic policy;
- global 20-round limit;
- coverage sufficiency or low expected information gain.

The transition from `active` to `scoring` is atomic and prevents new answers.

### 7.2 Formal scoring

For each answered question without a durable score:

- run the existing quality-tier `answer.score` task;
- validate the current six-dimension Schema;
- write `question_scores` and compatible feedback/deep-dive JSON;
- use the question ID as the idempotency boundary.

Already-scored questions are reused. Existing scores created before this migration remain valid.

Use bounded batches of up to three concurrent questions. Per-question retries and fallback remain independent so one failure does not replay every score.

If a question exhausts its scoring retry and fallback budget, the interview enters `failed` with an explicit retry action. Seconda does not silently substitute a zero score and does not generate a partial report whose missing score could be mistaken for a real evaluation.

### 7.3 Report generation

After all scoreable answers reach `scored`, transition to `reporting` and run the existing quality-tier report task. Persist `reportJson`, `overallScore`, and `completedAt` atomically before setting `completed`.

The report page must remain disabled while the interview is in `scoring` or `reporting`.

## 8. Run Terminal Events

Every Run exit path must append exactly one terminal event before its terminal status is committed:

| Exit reason | Terminal event |
| --- | --- |
| `completed` | `run_completed` |
| `max_turns` | `run_failed` |
| `aborted_streaming` | `run_failed` |
| `aborted_tools` | `run_failed` |
| `hook_stopped` | `run_failed` |
| `blocking_limit` | `run_failed` |
| `prompt_too_long` | `run_failed` |

`run_failed` payload:

```ts
{
  runId: string;
  exitReason: AgentExitReason;
  retryable: boolean;
  userMessage: string;
}
```

Terminal transitions and terminal events share one repository operation or database transaction. Repeated failure calls return the existing terminal result rather than creating another terminal event.

As a compatibility guard, the SSE endpoint may synthesize a terminal delivery from the Run row when it encounters an old terminal Run without a terminal event. The synthesized event is not appended twice.

## 9. SSE Lifecycle and Recovery

### 9.1 Listener cleanup

Every polling wait must:

- remove its abort listener after normal timeout;
- clear its timeout after abort;
- settle once;
- leave no listener after stream close.

### 9.2 Controlled reconnect

The client closes native `EventSource` inside `onerror` and owns reconnection explicitly.

1. Query the current Run state after a connection error.
2. If terminal, restore the terminal UI and do not reconnect.
3. If running, reconnect from the last persisted sequence.
4. Retry at most five consecutive times with full-jitter exponential delays capped at eight seconds.
5. After the limit, show a manual retry action.

`Last-Event-ID` and the explicit `after` cursor are both supported; the server uses the larger sequence.

### 9.3 Provisional content

- `text_delta` updates only a provisional buffer.
- `message_committed` replaces the buffer with a durable transcript message.
- `run_failed` clears the provisional buffer.
- A failed attempt can never appear as a committed interview question.
- Reconnect replay is deduplicated by event sequence and message identity.

## 10. Thinking and Background-result UX

### 10.1 Thinking panel behavior

Each new Run starts in automatic panel mode:

- start processing: automatically expand;
- receive public summaries and tool states: remain expanded;
- commit the next question or closing message: automatically collapse;
- fail the Run: remain expanded and show the failure reason;
- user may manually expand or collapse at any time;
- the next Run resets to automatic mode and expands again.

### 10.2 Thinking content sources

Allowed entries include:

- analyzing answer completeness;
- checking resume evidence;
- updating category coverage;
- deciding between follow-up, new topic, and completion;
- generating formal scores after completion;
- generating the report.

Each entry is produced from a public structured summary or a real lifecycle event. The UI must not invent progress and must not forward raw provider reasoning.

### 10.3 Committed result cards

Cards are rendered only after their domain write commits. Initial supported cards:

- `回答要点已提取`
- `简历证据已关联`
- `背景已保存`
- `当前主题覆盖度已更新`
- `面试方向已调整`
- `正式评分任务已创建`
- `报告生成中`

Cards contain a compact title, bounded summary, timestamp, and optional expandable details. Replayed events reuse the same stable artifact ID and cannot create duplicate cards.

`背景已保存` means the relevant answer assessment, evidence IDs, and coverage checkpoint are durable. It cannot be emitted for provisional model text.

## 11. Candidate Message Ordering

Submission uses an optimistic message with a stable client ID and idempotency key:

1. Append the candidate message to local transcript state.
2. Mark it `sending` and clear the editor.
3. POST the answer.
4. On `202`, reconcile the optimistic message with its durable message ID and sequence.
5. Only after acceptance, create/show the interviewer Run and expand the thinking panel.
6. On submission failure, mark the candidate message `failed` and expose a retry action using the same idempotency key.

The transcript sorts by durable sequence, falling back to local insertion order for optimistic messages. The interviewer-thinking indicator always renders after the current candidate message.

## 12. Initial Data and Duplicate Reads

The duplicate interview-detail GET observed in development is caused by React Strict Mode replaying client effects. It is not the same failure as the infinite Run reconnect loop, but it should still be removed.

Refactor the route into:

- a Server Component that loads the initial interview snapshot once;
- an Agent room Client Component that receives initial data;
- a shared in-flight refresh promise for post-submit and terminal reconciliation.

Do not disable Strict Mode or depend on a `useRef` flag that masks legitimate remounts.

## 13. Loop Detector Changes

The online assessment stage is removed from the model-visible tool surface, eliminating the repeated formal-score call.

The remaining detector rules become phase-aware:

- identical tool, arguments, and stable result: repetition;
- unchanged polling of the same resource: no-progress polling;
- alternating A/B/A/B pattern: ping-pong;
- repeated errors with the same corrective suggestion: repeated mistake;
- a committed phase transition resets the relevant no-progress counter;
- idempotent `alreadyCompleted` results return the required next phase and do not count as a new failure.

Warning, Warning, Break and the global breaker remain in force for genuinely continuous no-progress behavior.

## 14. API and Event Additions

Add or extend:

- a Run status endpoint used by reconnect recovery;
- durable assessment fields in interview detail responses;
- thinking lifecycle events;
- committed artifact events;
- scoring/report progress in interview detail responses.

Suggested event types:

```text
thinking_started
thinking_summary
artifact_committed
scoring_progress
reporting_started
run_completed
run_failed
```

All persisted events retain monotonic per-Run sequence numbers.

## 15. Error Handling

- Candidate POST failure: keep failed optimistic message with retry.
- Assessment failure: bounded retry and model fallback; do not start planning without an assessment unless an explicit deterministic fallback assessment is recorded.
- Agent Run failure: terminal event, provisional rollback, no automatic infinite reconnect.
- Scoring failure: retry only missing question scores.
- Report failure: retain completed scores and retry only report generation.
- User end during an active Run: transition interview state, abort or invalidate the in-flight question action, discard its provisional output, then start scoring.
- Old Run missing a terminal event: SSE compatibility synthesis from durable Run status.

## 16. Telemetry

Record:

- assessment latency and token usage;
- Agent planning latency;
- time to first public thinking summary;
- time from candidate submit to next committed question;
- SSE reconnect count and reason;
- active abort-listener count in tests;
- Run exit reason distribution;
- per-question scoring retries;
- total scoring and report duration.

Missing provider reasoning or cache metrics remain explicitly unavailable rather than zero.

## 17. Migration

1. Update the canonical PRD to distinguish online assessment from final scoring and document thinking/artifact UI behavior.
2. Add assessment and scoring-state persistence additively.
3. Treat existing `question_scores` as already scored.
4. Stop declaring `record_answer_evaluation` to new Agent Runs.
5. Allow old terminal Runs without terminal events to be read through SSE compatibility synthesis.
6. Keep v1 interviews read-only.
7. Roll out the new Worker phases before enabling the new client behavior.

No existing score or report is deleted.

The canonical PRD currently describes `回答 → 评估` without distinguishing decision-time assessment from formal scoring, and its legacy MVP out-of-scope wording conflicts with the already-shipped resumable SSE room. The PRD update must resolve both ambiguities before implementation begins.

## 18. Test Strategy

### Assessment

- one assessment per answer message;
- duplicate execution returns the same record without a model call;
- online assessment never writes `question_scores`;
- coverage update is linked to the committed assessment;
- missing question/answer binding is rejected.

### Final scoring

- no formal score is created during an active interview;
- completion scores every answered question;
- existing scores are reused;
- one question failure does not replay successful scores;
- the report starts only after scoring reaches its terminal condition;
- concurrent completion creates one scoring/report workflow.

### Run and SSE

- all seven exit reasons produce one terminal event;
- terminal connections do not reconnect;
- network failures reconnect at most five times;
- replay honors the maximum of query cursor and `Last-Event-ID`;
- provisional text clears on failure;
- repeated polling does not increase AbortSignal listeners.

### UI

- optimistic candidate message appears before thinking;
- failed candidate message remains retryable;
- thinking automatically expands on each new Run;
- committed result automatically collapses thinking;
- Run failure leaves thinking expanded;
- committed artifact replay does not duplicate cards;
- Strict Mode does not cause duplicate initial detail requests.

### Loop detector

- real repeated calls still produce Warning, Warning, Break;
- normal assessment, coverage, and action phases do not inherit stale warnings;
- ping-pong, unchanged polling, repeated error, and global breaker tests remain green.

## 19. Implementation Order

1. Update PRD and add persistence contracts/migrations.
2. Fix abort-listener cleanup and transactional terminal events.
3. Add Run status recovery and controlled client reconnect.
4. Correct optimistic message ordering and provisional rollback.
5. Add public thinking events and committed artifact cards.
6. Implement idempotent online assessment and coverage application.
7. Remove per-turn formal scoring from the Agent tool loop.
8. Make loop detection phase-aware.
9. Implement final batch scoring and report orchestration.
10. Move initial room loading to the server boundary.
11. Run migrations twice, unit/integration tests, build, failure injection, and browser QA.

## 20. Acceptance Criteria

- No `MaxListenersExceededWarning` occurs during a long interview.
- A terminal Run causes zero further automatic SSE requests.
- The candidate message renders before the interviewer-thinking state.
- Thinking expands during work, collapses after a committed result, and remains open on failure.
- No raw chain-of-thought is exposed.
- Background cards correspond only to committed durable actions.
- Active interviews contain no newly generated formal six-dimension scores.
- Completion produces formal scores for every successfully answered question and then generates one report.
- Adaptive follow-up behavior, resume grounding, category limit 3, round limit 20, and user-requested completion remain enforced.
