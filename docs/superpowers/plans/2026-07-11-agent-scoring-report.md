# Agent Scoring and Report Completion Plan

## Goal

Persist every Agent answer against its durable question, enforce the existing six-dimension scoring contract, and complete a report whether the Agent or the user ends the interview.

## Invariants

- The scoring model and 0–10 dimensions remain unchanged.
- Candidate acceptance binds the answer to the latest unanswered question in the same advisory-lock transaction.
- `record_answer_evaluation` accepts the strict existing `scoreResultSchema`; it cannot write arbitrary JSON.
- Scores are idempotent per question and feedback remains compatible with legacy report/deep-dive pages.
- Report completion reads only answered, scored durable questions.
- An interview is `completed` only after `reportJson` and `overallScore` are persisted.

## Tasks

1. Bind Agent candidate messages to the latest unanswered question transactionally.
2. Replace opaque evaluation input with the strict score schema and deterministically select the latest answered, unscored question.
3. Extract shared report completion logic from the legacy completion route.
4. Invoke report completion after Agent autonomous finish and explicit user end with idempotent status transitions.
5. Add tests for answer binding, score validation/idempotency, empty-report protection and repeated completion.
6. Run migrations twice, tests, typecheck, lint and build.
