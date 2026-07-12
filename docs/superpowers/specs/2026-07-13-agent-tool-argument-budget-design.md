# Agent Tool Argument and Repair Budget Design

## Problem

Production Agent output constrains the outer tool-call envelope but leaves `args` as `unknown`. A model can therefore emit structurally valid calls whose tool-specific arguments fail before execution. Those failures currently consume the same eight-step budget as productive planning, and pre-execution failures are absent from durable events. In the observed opening run, four rejected calls plus three successful reads exhausted the run before `ask_interview_question`.

## Design

Build the provider-facing schema from the tools available to the current run. Each `toolName` branch owns its exact Zod input schema, including enums, bounds, strict object keys, and defaults. The runtime-compatible generic schema remains for defensive tests and legacy input.

Opening runs expose only the tools needed to ground and submit an opening: resume evidence, coverage state, question submission, and completion. Interview history is available only after candidate answers exist.

Every tool proposal receives a durable completion event even when parsing, business validation, hooks, or authorization reject it. Public payloads contain sanitized error codes/messages and never raw provider errors.

Retryable pre-execution errors use a separate maximum of two repair attempts. They do not consume the eight productive model turns, while total provider calls remain bounded at ten. Non-retryable failures and repeated no-progress behavior continue through existing fuses.

## Validation

- Provider schema rejects malformed arguments for each tool branch.
- Opening tool descriptors exclude interview history.
- Pre-execution failures persist a structured completion event.
- Two retryable argument repairs do not consume productive turns; a third terminates through the existing bounded path.
- A realistic opening reads evidence and commits exactly one opening question within budget.
- Full tests, typecheck, lint, and production build pass.

## Scope

No resume data, scoring behavior, interview limits, or report contract changes.
