# Interview Agent Architecture

`lib/interview/agent` contains the resume-grounded interview Agent. The module is organized around the Agent execution lifecycle rather than HTTP or database frameworks.

## Modules

| Directory | Responsibility |
| --- | --- |
| `domain/` | Deterministic interview rules, assessment, coverage, resume evidence, grounding, proposal authorization, and response validation |
| `protocols/` | HTTP, model, run/checkpoint, event, and stream schemas shared across boundaries |
| `runtime/` | One resumable Agent Run, attempts, loop detection, buffering, and runtime policy |
| `prompts/` | System prompt, turn instructions, and public-analysis protocol |
| `context/` | Prompt assembly, token budgets, and persisted compaction |
| `tools/` | Model-visible tool registry and the validated execution pipeline |
| `skills/` | Deterministic skill catalog and per-run skill resolution |
| `providers/` | AI SDK model adapter and provider usage normalization |
| `persistence/` | Repository and interview-store contracts, in-memory and Drizzle implementations, and fencing |
| `application/` | Interview use cases, run execution/scheduling ports, recovery policy, and production composition |
| `events/` | Public event projections and room snapshot serialization |
| `transport/` | SSE delivery and PostgreSQL wake-up transport |
| `client/` | Browser event parsing, reconnect policy, pending answers, and room state |

Tests are colocated with the module they protect.

## Dependency Direction

```text
domain ← protocols
   ↑         ↑
   └── context / persistence / tools / skills
                         ↑
                      runtime ← providers
                         ↑
                    application ← API routes

protocols ← events
protocols / persistence ← transport
protocols ← client
```

Arrows point from a consumer to one of its dependencies. Shared model-port contracts live in `protocols/`, so the runtime never depends on a concrete provider. Domain rules do not import protocols, database, provider, transport, or UI modules. Persistence does not depend on application use cases. Client modules do not import Node-only providers or persistence implementations. Model proposals never bypass the deterministic authorization and persistence boundaries.

This organization does not change the PRD state machine, scoring model, resume snapshot semantics, category limits, or 20-round limit.
