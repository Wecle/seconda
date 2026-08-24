import type { AgentEvent } from "./types";
import type { AssistantDisplayBlock } from "./chunks";

export type ConversationStep = {
  sequence: number;
  blocks: AssistantDisplayBlock[];
};

export type ConversationEntry = {
  key: string;
  role: "user" | "assistant";
  runId: string | null;
  steps: ConversationStep[];
  closingSequence: number | null;
};

function contentBlocks(content: unknown): AssistantDisplayBlock[] {
  if (typeof content === "string") {
    return content ? [{ kind: "text", text: content, active: false }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; text?: unknown };
    if ((item.type === "text" || item.type === "reasoning") && typeof item.text === "string") {
      return [{ kind: item.type, text: item.text, active: false } satisfies AssistantDisplayBlock];
    }
    return [];
  });
}

function eventStep(event: AgentEvent): { role: "user" | "assistant"; step: ConversationStep } | null {
  if (event.type !== "model_message" && event.type !== "user_message" && event.type !== "assistant_message") {
    return null;
  }
  const message = event.payload.message;
  if (!message || typeof message !== "object") return null;
  const record = message as { role?: unknown; content?: unknown };
  if (record.role !== "user" && record.role !== "assistant") return null;
  const blocks = contentBlocks(record.content);
  return blocks.length > 0
    ? { role: record.role, step: { sequence: event.sequence, blocks } }
    : null;
}

function hasText(step: ConversationStep) {
  return step.blocks.some((block) => block.kind === "text" && block.text.trim() !== "");
}

/**
 * Projects the durable event log into chat rows without discarding per-step messages.
 * Assistant steps from one run share a single visual response; the last text-bearing
 * step is the run's closing assistant message.
 */
export function projectConversationEntries(events: readonly AgentEvent[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const keyOccurrences = new Map<string, number>();
  let turnAnchorSequence: number | null = null;
  let turnAssistant: ConversationEntry | null = null;

  for (const event of events) {
    const parsed = eventStep(event);
    if (!parsed) continue;

    if (parsed.role === "user") {
      turnAnchorSequence = event.sequence;
      turnAssistant = null;
      entries.push({
        key: `user:${event.sequence}`,
        role: "user",
        runId: event.runId,
        steps: [parsed.step],
        closingSequence: event.sequence,
      });
      continue;
    }

    if (
      turnAssistant !== null
      && turnAssistant.runId === event.runId
    ) {
      turnAssistant.steps.push(parsed.step);
      if (hasText(parsed.step)) turnAssistant.closingSequence = event.sequence;
      continue;
    }

    const baseKey = event.runId !== null
      ? `assistant-run:${event.runId}`
      : turnAnchorSequence !== null
        ? `assistant-turn:${turnAnchorSequence}:legacy`
        : `assistant:${event.sequence}`;
    const occurrence = keyOccurrences.get(baseKey) ?? 0;
    keyOccurrences.set(baseKey, occurrence + 1);
    const entry: ConversationEntry = {
      key: occurrence === 0 ? baseKey : `${baseKey}:${event.sequence}`,
      role: "assistant",
      runId: event.runId,
      steps: [parsed.step],
      closingSequence: hasText(parsed.step) ? event.sequence : null,
    };
    entries.push(entry);
    turnAssistant = turnAnchorSequence !== null || event.runId !== null ? entry : null;
  }

  return entries;
}

export function shouldAttachLiveAssistant(
  entries: readonly ConversationEntry[],
  running: boolean,
  activeRunId: string | null,
) {
  const lastEntry = entries.at(-1);
  return running
    && activeRunId !== null
    && lastEntry?.role === "assistant"
    && lastEntry.runId === activeRunId;
}
