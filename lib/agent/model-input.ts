import type { ModelMessage } from "ai";
import type { AgentEvent, ModelInputProjection } from "./types";

const SURFACE_TYPES = new Set([
  "user_message",
  "assistant_message",
  "tool_result_message",
  "model_message",
]);

function modelMessage(event: AgentEvent): ModelMessage | null {
  if (!SURFACE_TYPES.has(event.type)) return null;
  const message = event.payload.message;
  if (!message || typeof message !== "object") return null;
  const role = (message as { role?: unknown }).role;
  if (event.type === "user_message" && role !== "user") return null;
  if (event.type === "assistant_message" && role !== "assistant") return null;
  if (event.type === "tool_result_message" && role !== "tool") return null;
  if (event.type === "model_message" && role !== "user" && role !== "assistant" && role !== "tool") return null;
  return structuredClone(message as ModelMessage);
}

function replacement(event: AgentEvent) {
  if (event.type !== "model_context_replaced" && event.type !== "tool_result_spilled") return null;
  const shadowedSequences = event.payload.shadowedSequences;
  const message = event.payload.message;
  if (!Array.isArray(shadowedSequences) || shadowedSequences.length === 0) return null;
  if (!message || typeof message !== "object") return null;
  const role = (message as { role?: unknown }).role;
  if (event.type === "model_context_replaced" && role !== "user") return null;
  if (event.type === "tool_result_spilled" && role !== "tool") return null;
  const sequences = shadowedSequences.filter((value): value is number => Number.isSafeInteger(value));
  return sequences.length === shadowedSequences.length && new Set(sequences).size === sequences.length
    ? { sequences, message: structuredClone(message as ModelMessage) }
    : null;
}

function toolCallIds(message: ModelMessage) {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    return record.type === "tool-call" && typeof record.toolCallId === "string"
      ? [record.toolCallId]
      : [];
  });
}

function toolResultIds(message: ModelMessage) {
  if (message.role !== "tool" || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    return record.type === "tool-result" && typeof record.toolCallId === "string"
      ? [record.toolCallId]
      : [];
  });
}

function removeUnpairedTools(nodes: Array<{ sequence: number; message: ModelMessage }>) {
  const callPositions = new Map<string, number>();
  const resultPositions = new Map<string, number>();
  nodes.forEach(({ message }, index) => {
    for (const id of toolCallIds(message)) {
      if (!callPositions.has(id)) callPositions.set(id, index);
    }
    for (const id of toolResultIds(message)) {
      const callPosition = callPositions.get(id);
      if (callPosition !== undefined && !resultPositions.has(id)) resultPositions.set(id, index);
    }
  });
  const paired = new Set([...callPositions].flatMap(([id, callPosition]) => {
    const resultPosition = resultPositions.get(id);
    return resultPosition !== undefined && callPosition < resultPosition ? [id] : [];
  }));
  return nodes.filter(({ message }, index) => {
    const messageCalls = toolCallIds(message);
    const messageResults = toolResultIds(message);
    return messageCalls.every((id) => paired.has(id) && callPositions.get(id) === index)
      && messageResults.every((id) => paired.has(id) && resultPositions.get(id) === index);
  });
}

/**
 * Pure projection from the append-only event log to the current model-visible
 * surface. Lifecycle, chunks, pressure and compaction bookkeeping never enter
 * model history. Replacement events shadow source nodes without deleting them.
 */
export function projectModelInput(events: readonly AgentEvent[]): ModelInputProjection {
  let nodes: Array<{ sequence: number; message: ModelMessage }> = [];
  const ignored = new Set<number>();

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const projected = modelMessage(event);
    if (projected) {
      nodes.push({ sequence: event.sequence, message: projected });
      continue;
    }

    const replace = replacement(event);
    if (!replace) {
      ignored.add(event.sequence);
      continue;
    }
    const shadowed = new Set(replace.sequences);
    const start = nodes.findIndex(({ sequence }) => shadowed.has(sequence));
    const selected = start < 0
      ? []
      : nodes.slice(start, start + replace.sequences.length).map(({ sequence }) => sequence);
    if (selected.length !== replace.sequences.length
      || selected.some((sequence, index) => sequence !== replace.sequences[index])) {
      ignored.add(event.sequence);
      continue;
    }
    for (const sequence of selected) ignored.add(sequence);
    nodes = [
      ...nodes.filter((_, index) => index < start && !shadowed.has(nodes[index].sequence)),
      { sequence: event.sequence, message: replace.message },
      ...nodes.filter((_, index) => index >= start && !shadowed.has(nodes[index].sequence)),
    ];
  }

  const paired = removeUnpairedTools(nodes);
  const retained = new Set(paired.map(({ sequence }) => sequence));
  for (const node of nodes) if (!retained.has(node.sequence)) ignored.add(node.sequence);
  return {
    messages: paired.map(({ message }) => message),
    surfaceSequences: paired.map(({ sequence }) => sequence),
    ignoredSequences: [...ignored].sort((left, right) => left - right),
  };
}
