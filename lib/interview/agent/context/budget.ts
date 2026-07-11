export function estimateTokens(content: string) {
  return Math.ceil(content.length / 3);
}

export function effectiveContextBudget(input: {
  contextWindow: number;
  outputReserve: number;
  headroomRatio?: number;
}) {
  const headroom = Math.ceil(input.contextWindow * (input.headroomRatio ?? 0.2));
  return Math.max(0, input.contextWindow - headroom - input.outputReserve);
}
