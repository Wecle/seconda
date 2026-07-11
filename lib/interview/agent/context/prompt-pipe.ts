import { effectiveContextBudget, estimateTokens } from "./budget";

export type PromptSegment = {
  id: string;
  version: string;
  priority: number;
  cacheScope: "global" | "interview" | "epoch" | "turn";
  trimPolicy: "never" | "drop";
  content: string;
};

export function buildPromptPipe(input: {
  stableSegments: readonly PromptSegment[];
  tailSegments: readonly PromptSegment[];
  contextWindow: number;
  outputReserve: number;
  headroomRatio?: number;
}) {
  const effectiveBudget = effectiveContextBudget(input);
  const stablePrefix = serializeSegments(input.stableSegments);
  const stableTokens = estimateTokens(stablePrefix);
  if (stableTokens > effectiveBudget) {
    throw Object.assign(new Error("Stable prompt prefix exceeds the effective context budget"), {
      code: "PROMPT_TOO_LONG",
    });
  }

  let remaining = effectiveBudget - stableTokens;
  const included = [...input.tailSegments]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .filter((segment) => {
      const tokens = estimateTokens(serializeSegment(segment));
      if (segment.trimPolicy === "never" || tokens <= remaining) {
        remaining -= tokens;
        return true;
      }
      return false;
    });
  const incrementalTail = serializeSegments(included);
  return {
    stablePrefix,
    incrementalTail,
    includedTailIds: included.map((segment) => segment.id),
    effectiveBudget,
    estimatedTokens: stableTokens + estimateTokens(incrementalTail),
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function serializeSegments(segments: readonly PromptSegment[]) {
  return [...segments]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .map(serializeSegment)
    .join("\n");
}

function serializeSegment(segment: PromptSegment) {
  return `<context-segment id="${segment.id}" version="${segment.version}" scope="${segment.cacheScope}">\n${segment.content}\n</context-segment>`;
}
