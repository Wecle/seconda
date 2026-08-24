export type AssistantDisplayBlock = {
  kind: "text" | "reasoning";
  text: string;
  active: boolean;
};

export function applyAssistantChunk(
  blocks: readonly (AssistantDisplayBlock | undefined)[],
  value: unknown,
) {
  if (!value || typeof value !== "object") return blocks;
  const chunk = value as { type?: unknown; index?: unknown; blockType?: unknown; text?: unknown };
  if (!Number.isInteger(chunk.index) || typeof chunk.index !== "number" || chunk.index < 0) return blocks;

  const next = [...blocks];
  if (chunk.type === "block-start" && (chunk.blockType === "text" || chunk.blockType === "reasoning")) {
    next[chunk.index] = { kind: chunk.blockType, text: "", active: true };
    return next;
  }
  if ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && typeof chunk.text === "string") {
    const kind = chunk.type === "text-delta" ? "text" : "reasoning";
    const previous = next[chunk.index];
    next[chunk.index] = {
      kind,
      text: (previous?.kind === kind ? previous.text : "") + chunk.text,
      active: true,
    };
    return next;
  }
  if (chunk.type === "block-end") {
    const previous = next[chunk.index];
    if (!previous) return blocks;
    next[chunk.index] = { ...previous, active: false };
    return next;
  }
  return blocks;
}

export function compactAssistantBlocks(blocks: readonly (AssistantDisplayBlock | undefined)[]) {
  return blocks.filter((block): block is AssistantDisplayBlock => block !== undefined);
}
