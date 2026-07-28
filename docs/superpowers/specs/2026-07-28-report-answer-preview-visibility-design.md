# Report answer preview visibility

## Goal

Avoid showing the candidate answer twice when a report question card is expanded.

## Scope

Apply the same behavior to:

- The authenticated interview report.
- The public shared interview report.

No report data, scoring, filtering, navigation, or accordion behavior changes.

## Interaction

- When a question card is collapsed, show the existing one-line answer preview below the question.
- When a question card is expanded, hide that preview.
- In the expanded content, continue showing the complete answer under “Your answer” / “你的回答”.
- Cards without an answer continue to omit both the preview and the full-answer section.

## Implementation

Use the accordion item’s existing `data-state` attribute as the source of truth. Mark each question item as a Tailwind group and hide only its preview while that item is open. This avoids duplicating accordion state in React and keeps each card’s visibility tied to the Radix accordion state.

## Verification

- Type-check the affected React pages.
- Verify the authenticated and shared report implementations both contain the open-state visibility rule.
- Confirm the preview remains line-clamped in the collapsed state and the full answer remains visible in expanded content.
