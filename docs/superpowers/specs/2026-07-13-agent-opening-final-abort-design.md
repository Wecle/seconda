# Agent Opening and Report Abort Fix Design

## Problem

Opening runs can exhaust all eight model turns because the provider-facing schema permits a `final` result while the runtime requires a terminal domain tool (`ask_interview_question` or `finish_interview`) to complete a run. Report navigation also produces an unhandled `AbortError` because the initial report request is intentionally aborted during effect cleanup without observing the rejected promise.

## Design

Keep the runtime's `final` branch as a defensive compatibility path, but expose a tool-call-only schema to production model generation. The provider prompt must explicitly require exactly one available domain tool call. Opening therefore ends through `ask_interview_question`; interview completion ends through `finish_interview`.

Handle report request cancellation at the effect boundary. Cleanup-triggered `AbortError` is expected and ignored; other failures stop loading and surface the existing page action-message mechanism. The polling hook already observes and catches its refresh promise, so it remains unchanged unless regression testing reveals another leak.

## Validation

- A provider-facing output schema rejects `final`.
- The runtime still safely handles legacy `final` values and enforces its turn fuse.
- An opening sequence can read coverage and then commit an opening question.
- Aborting the initial report request produces no unhandled rejection.
- Full tests, typecheck, lint, and production build pass.

## Scope

This does not change resume selection, interview scoring, question limits, or completion behavior. Historical resumes are not migrated or modified.
