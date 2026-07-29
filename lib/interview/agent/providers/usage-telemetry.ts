export type NormalizedModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
};

export function normalizeModelUsage(value: unknown): NormalizedModelUsage {
  const usage = isRecord(value) ? value : {};
  const details = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : {};
  return {
    inputTokens: readTokenCount(usage.inputTokens) ?? 0,
    outputTokens: readTokenCount(usage.outputTokens) ?? 0,
    cachedInputTokens: readTokenCount(details.cacheReadTokens ?? usage.cachedInputTokens),
    cacheWriteTokens: readTokenCount(details.cacheWriteTokens ?? usage.cacheWriteTokens),
  };
}

export function cacheHitRatio(usage: NormalizedModelUsage) {
  if (usage.cachedInputTokens === null || usage.inputTokens <= 0) return null;
  return usage.cachedInputTokens / usage.inputTokens;
}

function readTokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
