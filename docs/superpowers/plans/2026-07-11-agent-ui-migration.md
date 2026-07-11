# Agent Interview UI Migration Plan

## Goal

Make the bounded Agent runtime the default for newly created interviews while preserving legacy v1 interviews as readable historical sessions.

## Migration invariants

- New settings contain language, interviewer persona, preference text/tags and inferred target role only.
- New interviews always submit `configVersion: 2`; removed level/type/question-count fields never cross the v2 API boundary.
- The room selects its data flow from persisted `configVersion`, not a client-side guess.
- Agent messages are committed only by `message_committed`; `text_delta` remains provisional and reconnects with the last persisted event sequence.
- User end is explicit and idempotent. The Agent may also finish autonomously within category and global bounds.
- Existing v1 interview URLs remain readable; no v1 data rewrite is required.

## Tasks

1. Refactor interview settings UI to the v2 schema and persist preferences per resume.
2. Change Dashboard creation to v2 and route directly to the Agent room.
3. Extend interview detail API with `configVersion`, Agent messages, coverage and latest run state.
4. Build an Agent room client with opening-run hydration, SSE replay/heartbeat, provisional text, answer submission, reconnect and manual end.
5. Dispatch the room by persisted version and retain the legacy room for v1 history.
6. Adapt history labels and completion/report navigation to autonomous round counts.
7. Validate migrations twice, tests, typecheck, lint, build and an optional live Agent contract.

## Rollback

Restore v1 as the Dashboard creation payload while keeping all additive Agent tables and v2 sessions intact. Version-based room dispatch continues to make both formats readable.
