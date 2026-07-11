# Agent Deferred Tools and Skills Plan

## Goal

Keep the model-facing tool surface and instructions minimal per run while preserving deterministic execution, validation and checkpoint recovery.

## Design

- A Skill is versioned metadata plus bounded instructions and required tool names.
- Skill metadata is cheap to enumerate; full instructions are injected only for active skills.
- Opening runs activate resume grounding and coverage planning.
- Answer runs additionally activate answer evaluation.
- Only the union of active-skill tools plus terminal tools is declared to the model; the full validated registry remains server-side.
- Active skill names are persisted in every Agent checkpoint and restored on resumed execution.
- Unknown skills, duplicate names, missing tools and oversized instructions fail before a model call.

## Tasks

1. Add strict Skill contracts, catalog validation and mode-based activation tests.
2. Build a deferred tool view from active skills without changing the execution pipeline.
3. Inject active Skill instructions after the cache-stable prefix and persist names in checkpoints.
4. Correct tool descriptions to match the constrained schemas.
5. Document authoring rules and run the complete validation matrix.
