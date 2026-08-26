import type { ModelMessage } from "ai";

export const DEFAULT_CONTEXT_WINDOW = 64_000;
export const CONTEXT_PRESSURE_RATIO = 0.78;
export const CONTEXT_RETAIN_RATIO = 0.32;
export const TOOL_RESULT_SPILL_CHARS = 12_000;
export const TOOL_RESULT_SPILL_HEAD_CHARS = 4_000;
export const TOOL_RESULT_SPILL_TAIL_CHARS = 2_000;

export type ContextCapacity = {
  hardContextWindow: number;
  operationalBudget: number;
  maxOutputTokens: number;
};

const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek/deepseek-chat": 128_000,
  "deepseek/deepseek-reasoner": 128_000,
  "deepseek/deepseek-v4-flash": 1_048_576,
  "deepseek/deepseek-v4-pro": 1_048_576,
};

const KNOWN_CONTEXT_BUDGETS: Record<string, number> = {
  "deepseek/deepseek-chat": 64_000,
  "deepseek/deepseek-reasoner": 64_000,
  "deepseek/deepseek-v4-flash": 128_000,
  "deepseek/deepseek-v4-pro": 128_000,
};

export function resolveContextWindow(model: string, env: Record<string, string | undefined> = process.env) {
  const configured = env.AGENT_MODEL_CONTEXT_WINDOWS_JSON?.trim();
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, unknown>;
      const value = parsed[model];
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
    } catch {
      // Ignore invalid JSON configuration and fall through to known defaults
    }
  }
  return KNOWN_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

export function resolveContextBudget(
  model: string,
  hardContextWindow?: number,
  env: Record<string, string | undefined> = process.env,
) {
  const effectiveHardWindow = hardContextWindow ?? resolveContextWindow(model, env);
  const configured = env.AGENT_MODEL_CONTEXT_BUDGETS_JSON?.trim();
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, unknown>;
      const value = parsed[model];
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
        return Math.min(value, effectiveHardWindow);
      }
    } catch {
      // Ignore invalid JSON configuration and fall through to known defaults
    }
  }
  const known = KNOWN_CONTEXT_BUDGETS[model];
  if (known !== undefined) {
    return Math.min(known, effectiveHardWindow);
  }
  return Math.min(DEFAULT_CONTEXT_WINDOW, effectiveHardWindow);
}

export function resolveContextCapacity(model: string, env: Record<string, string | undefined> = process.env): ContextCapacity {
  const hardContextWindow = resolveContextWindow(model, env);
  const operationalBudget = resolveContextBudget(model, hardContextWindow, env);
  const maxOutputTokens = Math.min(8_192, Math.max(1, Math.floor(operationalBudget * 0.15)));
  return { hardContextWindow, operationalBudget, maxOutputTokens };
}

export function estimateTextTokens(text: string) {
  if (!text) return 0;
  let ascii = 0;
  let nonAscii = 0;
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

export function estimateMessageTokens(message: ModelMessage) {
  return 4 + estimateTextTokens(JSON.stringify(message));
}

export function measureRequestTokens(system: string, messages: readonly ModelMessage[], toolSchemas: unknown) {
  return estimateTextTokens(system) + messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
    + estimateTextTokens(JSON.stringify(toolSchemas)) + 16;
}

export function contextPressure(input: {
  estimatedTokens: number;
  contextWindow?: number;
  hardContextWindow?: number;
  operationalBudget?: number;
  reserveTokens?: number;
  maxOutputTokens?: number;
}) {
  const hardContextWindow = input.hardContextWindow ?? input.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const operationalBudget = Math.min(
    input.operationalBudget ?? input.contextWindow ?? hardContextWindow,
    hardContextWindow,
  );
  const reserveTokens = input.reserveTokens
    ?? input.maxOutputTokens
    ?? Math.min(8_192, Math.max(1, Math.floor(operationalBudget * 0.15)));
  const usableTokens = Math.max(1, operationalBudget - reserveTokens);
  const hardSafetyLimit = Math.max(1, Math.floor(hardContextWindow * 0.95) - reserveTokens);
  const pressureThreshold = Math.floor(operationalBudget * CONTEXT_PRESSURE_RATIO);
  const pressured = input.estimatedTokens >= pressureThreshold
    || input.estimatedTokens >= usableTokens
    || input.estimatedTokens >= hardSafetyLimit;

  return {
    hardContextWindow,
    operationalBudget,
    reserveTokens,
    usableTokens,
    hardSafetyLimit,
    pressureThreshold,
    ratio: operationalBudget > 0 ? input.estimatedTokens / operationalBudget : 1,
    pressured,
  };
}

export function cropToolResultMessage(message: ModelMessage) {
  if (message.role !== "tool") return null;
  const points = Array.from(JSON.stringify(message.content));
  if (points.length <= TOOL_RESULT_SPILL_CHARS) return null;
  const omitted = points.length - TOOL_RESULT_SPILL_HEAD_CHARS - TOOL_RESULT_SPILL_TAIL_CHARS;
  const preview = `${points.slice(0, TOOL_RESULT_SPILL_HEAD_CHARS).join("")}\n… ${omitted} characters spilled to the durable event log …\n${points.slice(-TOOL_RESULT_SPILL_TAIL_CHARS).join("")}`;
  const content = message.content.map((part, index) => {
    if (!part || typeof part !== "object") return part;
    const record = part as unknown as Record<string, unknown>;
    if (record.type !== "tool-result") return part;
    return {
      ...record,
      output: index === 0
        ? { type: "text", value: preview }
        : { type: "text", value: "[spilled to durable event log]" },
    };
  });
  return { role: "tool", content } as ModelMessage;
}
