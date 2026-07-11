# Seconda Interview Agent Runtime Design

**Date:** 2026-07-11

**Status:** Approved design

**Scope:** Replace the fixed-question interview workflow with a bounded, resumable interview agent while preserving the existing six-dimension scoring model and report experience.

## 1. Product Contract

The interview becomes a continuous conversation driven by a resume-grounded agent. The setup screen removes target level, interview type, and question count. It retains language and interviewer persona and adds a free-text interview preference plus optional preference tags.

The first assistant message identifies the likely target role from the resume and asks the candidate to introduce themselves. When the resume supports multiple plausible roles and none has sufficient confidence, the agent asks the user to choose a direction instead of silently selecting one.

The agent may ask a new topic question, deepen the current topic, verify resume evidence, or finish the interview. It must never invent candidate experience. User preferences are soft guidance and cannot override resume-grounding, safety rules, scoring rules, or runtime limits.

Before implementation, the full PRD and the Core Requirements in `AGENTS.md` must be updated because the existing documents require fixed level, type, question count, pre-generated questions, and one independent conversation per question.

## 2. Interview Limits and Completion

The model proposes the next action, but deterministic application code authorizes it.

- The interview has at most 20 candidate-answer rounds.
- Each question category has at most 3 questions, including follow-ups in that category.
- A candidate can explicitly end the interview at any time.
- The agent can finish when resume coverage and answer evidence are sufficient or further questions have low information gain.
- Reaching 20 rounds always ends the interview.
- A model cannot bypass these limits through prompt output or tool arguments.

Question categories are a closed enum:

```ts
type QuestionCategory =
  | "introduction"
  | "resume_project"
  | "technical_depth"
  | "problem_solving"
  | "behavioral"
  | "collaboration"
  | "leadership"
  | "career_motivation"
  | "reflection";
```

The agent produces a structured decision:

```ts
type InterviewDecision = {
  action: "ask" | "finish" | "clarify";
  category: QuestionCategory;
  intent: "new_topic" | "follow_up" | "verify_evidence";
  coverageTarget: string;
  rationale: string;
  estimatedInformationGain: "low" | "medium" | "high";
};
```

The policy layer rejects category overflow, global-round overflow, missing resume evidence, multi-question output, and recent semantic duplicates.

## 3. Architecture Choice

Use a persistent, bounded agent runtime. Each candidate answer starts a short-lived agent run inside the existing Next.js architecture:

1. Restore the latest checkpoint and persisted events.
2. Build a token-budgeted context for this run.
3. Ask the model to select or invoke an allowed domain tool.
4. Validate and execute tools through one pipeline.
5. Append events and checkpoint durable state.
6. Commit one interviewer message or an interview-completion result.

This avoids a permanently running process while supporting retries, replay, server restarts, deterministic constraints, and future migration to a background worker.

A single-prompt agent is rejected because it cannot reliably recover, enforce limits, or prevent repeated questions. A dedicated queue worker is deferred because the current application has no queue infrastructure and does not need that deployment cost for the first version.

## 4. State Machine

```text
setup
  -> opening
  -> awaiting_answer
  -> evaluating
  -> planning
      -> awaiting_answer
      -> completing
  -> report
```

The user may transition `awaiting_answer -> completing` by explicitly ending the interview. Runtime failures end the current agent run but do not automatically corrupt or complete the interview.

## 5. Persistence Model

### 5.1 Agent runs

`interview_agent_runs` records lifecycle, exit reason, model, stream mode, turn and token usage, the latest checkpoint, and sanitized error details.

Each run has exactly one terminal exit reason:

- `completed`
- `max_turns`
- `aborted_streaming`
- `aborted_tools`
- `hook_stopped`
- `blocking_limit`
- `prompt_too_long`

`max_turns` limits internal model/tool iterations in one run, not candidate-answer rounds. The initial default is 8 model turns per run.

### 5.2 Messages and questions

`interview_messages` becomes the canonical continuous transcript. It stores user, assistant, system, and tool messages with a monotonic interview sequence, message kind, run association, and optional question association.

Existing `interview_questions` and `question_scores` remain as compatibility projections for scoring, reports, and deep dives. Clarifications, tool results, and closing messages are not scoreable questions.

### 5.3 Append-only events

`interview_agent_events` stores run events with a monotonic sequence:

- `run_started`
- `model_started`
- `text_delta`
- `tool_call_started`
- `tool_call_completed`
- `warning`
- `checkpoint`
- `compacted`
- `message_committed`
- `run_completed`
- `run_failed`

The sequence is the recovery and deduplication cursor. High-frequency transient UI state does not enter the canonical transcript.

### 5.4 Coverage and context snapshots

`interview_coverage` stores category, topic, resume evidence references, question count, depth, evidence quality, and coverage status.

`interview_context_snapshots` stores a structured summary, coverage snapshot, active follow-up threads, resume evidence index version, transcript boundary, and token estimate.

New interviews use `configVersion: 2`. Legacy interviews keep their original fields and routes until migration is complete.

## 6. Tool System

The first release exposes only interview-domain tools:

1. `get_resume_evidence`
2. `get_interview_history`
3. `get_coverage_state`
4. `record_answer_evaluation`
5. `update_coverage`
6. `ask_interview_question`
7. `finish_interview`

The agent receives no shell, filesystem, network, or arbitrary database tool. The model cannot write application tables directly.

Every call passes through this pipeline:

```text
schema validation
-> normalization and safe completion
-> business validation
-> before-tool hook
-> permission and run-state check
-> execution
-> after-tool hook
-> result normalization
-> event persistence
```

Tool inputs use enums and bounded strings wherever possible. Errors are structured and actionable, for example:

```ts
{
  code: "CATEGORY_LIMIT_REACHED",
  message: "technical_depth has reached its 3-question limit",
  retryable: false,
  suggestion: "Choose an insufficiently covered category"
}
```

Hooks may stop or narrow an operation but may not broaden permissions.

## 7. Agent Loop Guardrails

Every tool call is fingerprinted from:

```text
tool name + canonical arguments hash + normalized result hash
```

The runtime detects:

- repeated calls with the same tool and arguments;
- polling with no result or state change;
- alternating A-B-A-B ping-pong patterns;
- repeated unknown-tool calls;
- globally different calls that do not change coverage or checkpoint state;
- recurrence of the same call/result pattern immediately after compaction.

The response has three levels:

1. Warning: explain the detected pattern to the model.
2. Warning: prohibit the current strategy and require a different action.
3. Break: terminate the run with `blocking_limit` or `aborted_tools`.

Initial thresholds are deliberately lower than a general-purpose coding agent:

- first warning at 3 matching pattern observations;
- second warning at 5;
- break at 7;
- at most 12 tool calls per run;
- at most 6 calls to one tool per run;
- at most 4 calls without coverage or checkpoint progress.

Thresholds are configuration values and require table-driven tests before tuning.

## 8. Streaming Reliability and Recovery

### 8.1 Retry and fallback

Only transient failures are retried: 408, 429, provider 5xx, network disconnects, and provider idle timeouts. Authentication, permission, and business-schema failures are not retried.

Retry policy uses full-jitter exponential backoff with a 500 ms base, factor 2, and 8 second cap. A model gets at most two transient retries before fallback.

Fallback order:

```text
primary streaming
-> primary streaming retry
-> fallback model streaming
-> fallback model non-streaming
-> safe template or recoverable error
```

### 8.2 Heartbeats and stuck streams

The server emits a connection heartbeat about every 10 seconds. Separately, the provider adapter tracks meaningful upstream progress. No provider delta or tool event for 20-30 seconds triggers an upstream idle timeout. A downstream heartbeat never counts as provider progress.

### 8.3 Accepted-content boundary

Streamed text is provisional until it passes validation and the final message is persisted. The client receives a distinct `message_committed` event.

Before any provisional text has been shown, the runtime may transparently retry or change models. After user-visible text has been emitted, it must not silently concatenate output from another model into the same message. If the original run cannot resume, its provisional text is marked interrupted and a new message id is generated.

### 8.4 Reconnection

The client reconnects with `runId` and `lastReceivedSequence`. The server replays later persisted events and then follows the live run. If a server process disappeared, the run resumes from its latest valid checkpoint. Candidate messages use idempotency keys so duplicate HTTP submissions cannot create duplicate questions.

## 9. Context Engineering

Prompt construction moves out of API routes into a Prompt Pipe. Ordered layers are:

1. immutable safety and resume-grounding rules;
2. interviewer persona;
3. interview and completion policies;
4. resume snapshot overview;
5. current coverage state;
6. recent raw conversation;
7. compacted historical summary;
8. user interview preferences;
9. current run instruction;
10. tools visible for this turn.

Each layer declares priority, token budget, cache key, trust level, and whether it may be trimmed.

Restoring a run does not mean regenerating every prompt segment. The Prompt Pipe incrementally assembles versioned segments and preserves the longest possible stable prefix:

1. stable system rules, scoring rules, persona contract, and fixed tool schemas;
2. semi-stable resume overview, interview preference, and confirmed target role;
3. a checkpoint summary and compact coverage state that change only at a compaction boundary;
4. an append-only recent conversation tail and the current candidate answer.

Stable segments must not contain timestamps, random identifiers, volatile counters, nondeterministic object-key ordering, or reordered tool definitions. New conversation content is appended after cached segments rather than inserted into the middle. A prompt-template version change, target-role correction, tool-contract change, or compaction checkpoint starts a new cache epoch; ordinary interview turns do not.

Compaction is low-frequency rather than per-turn. The initial policy checks after every turn but normally creates a new checkpoint only after 4-6 candidate rounds or when the configured token-pressure threshold is crossed. Coverage is persisted in full but injected as a compact deterministic projection; detailed evidence is loaded through tools only when needed.

Runtime telemetry records `inputTokens`, `cachedInputTokens`, `cacheWriteTokens` when the provider exposes them, `outputTokens`, cache-hit ratio, compaction cost, and estimated cost per interview turn. Model fallback never assumes cache portability across providers. The routing policy should keep a healthy interview on the same provider and model unless reliability policy requires a switch.

### 9.1 Three-level compaction

1. Lightweight pruning removes duplicated static text, old low-value tool results, and redundant metadata.
2. Structured compaction summarizes old conversation into facts, evidence, coverage, scores, and unresolved threads while keeping a recent raw tail.
3. Prompt-too-long recovery removes older raw groups and retains the structured summary, resume evidence identifiers, coverage limits, active follow-up, and the most recent messages.

Tool call and tool result pairs cannot be split. Compaction preserves opaque resume evidence identifiers and reinjects active skills and deferred tool declarations. Repeated compaction failure has its own circuit breaker and ultimately exits as `prompt_too_long`.

### 9.2 Just-in-time context

The initial context contains a resume overview and evidence index, not the complete resume on every turn. The agent calls `get_resume_evidence` when it needs the source passage for a project or claim. Tool results are bounded and carry stable evidence ids.

## 10. Deferred Tools and Skills

Direct tool exposure remains the default while the catalog is small. Deferred loading starts only when the tool catalog becomes large enough to create measurable prompt cost.

Deferred tools expose a compact searchable directory. The agent searches and loads a selected schema just in time, but all execution still returns through the same permission, hook, validation, logging, and loop-detection pipeline.

Skills are versioned `SKILL.md` instruction packages, initially for workflows such as project deep dive, STAR behavioral interviewing, and system design. Metadata includes allowed tools, applicable roles, language, and version.

- Only the skill directory is visible by default.
- Full instructions load when a skill is selected.
- Active skills are stored in the checkpoint and reinjected after compaction.
- A skill can narrow but never expand tool permissions.
- Skills cannot execute embedded shell commands.
- Skill instructions cannot override immutable system constraints.

## 11. API and UI

The target API is:

```text
POST /api/interviews
POST /api/interviews/:id/messages
POST /api/interviews/:id/end
GET  /api/interviews/:id/events?after=<sequence>
GET  /api/interviews/:id/state
```

Creating an interview no longer pre-generates three questions. It creates the interview, snapshot, initial coverage state, and opening agent run.

The room becomes a continuous interview conversation. It removes current/total question framing and shows topic coverage, completed areas, current status, resume access, and an explicit end-interview action. It retains text answering and existing accessibility conventions.

The visual direction may borrow Sitor's continuous interviewer/candidate conversation and side coverage view, but Seconda retains its own report, six-dimension scoring, resume snapshot, and deep-dive flows.

## 12. Scoring and Reports

The six dimensions and overall scoring model do not change. Every committed scoreable question projects into `interview_questions`; every answer can be scored asynchronously. Clarification and closing messages are excluded.

Report generation waits until all expected score jobs are successful or explicitly terminal. Scoring failures are durable retryable jobs rather than untracked `after()` work. Reports may add topic coverage but must not replace or reinterpret the six dimensions.

## 13. Migration and Rollout

Use `INTERVIEW_AGENT_V2_ENABLED` and `configVersion` for dual operation:

1. Update PRD and contracts.
2. Add v2 tables and types without deleting legacy fields.
3. Implement event storage, runtime, policies, tools, and guardrails.
4. Enable v2 only for newly created development interviews.
5. Add resumable streaming and context management.
6. Switch the interview room and setup UI for v2 sessions.
7. Shadow-log runtime decisions and monitor failures, repeats, token use, early completion, and recovery success.
8. Gradually make v2 the default.
9. Remove legacy pre-generation and next-question code only after historical interviews and reports remain verified.

The first usable delivery ends after steps 1-4: reliable opening, follow-ups, autonomous completion, category limits, global limits, event persistence, and loop protection. Deferred tools and the general Skills platform do not block product validation.

## 14. Verification

Required automated scenarios include:

- confident and ambiguous target-role openings;
- rejection of the fourth question in one category;
- forced completion at round 20;
- user-requested completion;
- correct accounting for deep follow-ups;
- idempotent duplicate candidate-message submission;
- every run exit reason;
- retry before provisional output and no cross-model concatenation afterward;
- reconnection and event replay by sequence;
- recovery after server restart;
- generic repeat, polling, ping-pong, and global no-progress detection;
- compaction that preserves evidence ids, limits, active skills, and tool pairs;
- terminal `prompt_too_long` after bounded recovery;
- continued access to legacy interviews and reports.

Final validation commands:

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
```

## 15. Risks and Recovery

- **Early autonomous completion:** deterministic coverage policy authorizes model finish decisions and records rationale.
- **Cross-layer migration risk:** v1 and v2 remain readable behind versioned adapters and a feature flag.
- **Lost background scoring:** replace best-effort `after()` work with persistent job state and compensation scans.
- **Stream/database divergence:** only transactionally persisted messages receive `message_committed`.
- **Fact loss during compaction:** use a structured summary with stable resume evidence identifiers and preserve the recent raw tail.
- **False-positive loop detection:** keep detectors observable, configurable, and separately disableable after table-driven tests.
- **Platform overengineering:** build domain tools and the interview agent first; defer generic tool search and broad Skills until usage justifies them.

Rollback is version-based: disable `INTERVIEW_AGENT_V2_ENABLED`, keep v2 data intact for diagnosis, and route new sessions back to the legacy workflow. Database migrations are additive until the v2 rollout is complete.

## 16. Implementation Order

```text
PRD and Core Requirements
-> versioned database and domain contracts
-> event log and bounded agent runtime
-> interview-domain tools
-> loop guardrails
-> resumable streaming and model fallback
-> Prompt Pipe, JIT context, and compaction
-> v2 setup and interview room
-> durable scoring and report integration
-> deferred tools and Skills
-> staged rollout and legacy cleanup
```
