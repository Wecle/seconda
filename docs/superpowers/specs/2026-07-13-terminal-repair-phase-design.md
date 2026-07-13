# Interview Agent Terminal Repair Phase Design

## Problem

Interview `37af3e4b-36be-48c8-8c30-6f3b86da2df4` failed in run
`82b34f90-16e5-465a-967d-60c927096e73` with `terminal_action_failed`.

The observed sequence was:

1. The Agent called `get_interview_history`.
2. It called `ask_interview_question` without a valid `resumeEvidenceIds` value.
3. Deterministic policy rejected the action with `MISSING_EVIDENCE` and instructed the Agent to call `get_resume_evidence`.
4. Runtime immediately switched to the terminal phase because a terminal tool had been attempted.
5. Terminal phase exposed only `ask_interview_question` and `finish_interview`, so the required evidence-recovery tool was unavailable.
6. Two more question attempts failed with the same error and exhausted the three terminal attempts.

The resume evidence existed. The failure was caused by a missing evidence ID in the tool input followed by a runtime phase transition that made the prescribed repair impossible.

## Goal

Allow an Agent to recover from a failed early terminal action while preserving all existing deterministic interview constraints and finite budgets.

## Non-goals

- Do not weaken the requirement that questions are grounded in resume evidence.
- Do not automatically invent or infer evidence IDs inside the validator.
- Do not increase the existing limits of 15 planning steps or 3 terminal attempts.
- Do not change the interview scoring model, question limits, or candidate round limit.

## State Machine

The runtime has two phases:

- `planning`: all tools selected by the active skills are available.
- `terminal`: only `ask_interview_question` and `finish_interview` are available.

The phase transition rules become:

1. Reaching 15 non-terminal tool calls switches the runtime to `terminal`.
2. A successful `ask_interview_question` or `finish_interview` completes the run.
3. A failed terminal action increments `terminalAttemptCount`.
4. If the failed terminal action happened before the planning budget was exhausted and fewer than three terminal attempts have been used, the next model call runs in `planning` so the Agent can use evidence, history, coverage, or other active repair tools.
5. If the planning budget is exhausted, the runtime remains in `terminal` after a failed terminal action.
6. The third failed terminal action ends the run with `terminal_action_failed` regardless of phase.
7. Invalid final text or unavailable tools retain their existing bounded-repair behavior.

The terminal attempt budget remains independent from the planning budget. Returning to planning does not refund or decrement a terminal attempt.

## Data Flow

For the reported failure, the corrected flow is:

```text
ask_interview_question
  -> MISSING_EVIDENCE
  -> terminalAttemptCount = 1
  -> planning phase
  -> get_resume_evidence(project evidence ID)
  -> ask_interview_question(resumeEvidenceIds = [...])
  -> success
```

No database migration or API contract change is required. Existing checkpoints already persist the phase, planning count, and terminal attempt count.

## Error Handling

- Tool errors continue to be returned to the model as structured tool results.
- A failed early terminal action must not hide the recovery tools named by its error suggestion.
- Three failed terminal actions still produce the existing candidate-facing message: `本轮问题生成未能通过运行规则，请重试。`
- Provider failures, aborts, hooks, and loop blocking keep their existing exit reasons.

## Testing

Add a runtime regression test that models the production sequence:

1. A terminal action fails with `MISSING_EVIDENCE`.
2. The following model call sees planning tools, including `get_resume_evidence`.
3. Evidence loading consumes one planning step but no terminal attempt.
4. A second terminal action succeeds.
5. The run completes with one planning step and two terminal attempts.

Retain tests proving:

- 15 planning calls force terminal-only tools.
- Early terminal calls do not consume planning steps.
- Three terminal failures stop the run.
- Provider retries remain independent.

Run the focused runtime tests, full test suite, lint, TypeScript check, and production build. Then reproduce the behavior in a fresh interview turn without mutating or replaying the already failed run.
