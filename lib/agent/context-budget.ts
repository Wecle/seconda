import type { ModelMessage } from "ai";

export const DEFAULT_CONTEXT_WINDOW = 64_000;
export const CONTEXT_PRESSURE_RATIO = 0.78;
export const CONTEXT_RETAIN_RATIO = 0.32;
export const TOOL_RESULT_SPILL_CHARS = 12_000;
export const TOOL_RESULT_SPILL_HEAD_CHARS = 4_000;
export const TOOL_RESULT_SPILL_TAIL_CHARS = 2_000;

const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek/deepseek-chat": 128_000,
  "deepseek/deepseek-reasoner": 128_000,
};

export function resolveContextWindow(model: string, env: Record<string, string | undefined> = process.env) {
  const configured = env.AGENT_MODEL_CONTEXT_WINDOWS_JSON?.trim();
  if (configured) {
    const parsed = JSON.parse(configured) as Record<string, unknown>;
    const value = parsed[model];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  }
  return KNOWN_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
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

export function contextPressure(input: { estimatedTokens: number; contextWindow: number; reserveTokens?: number }) {
  const reserveTokens = input.reserveTokens ?? Math.min(8_192, Math.floor(input.contextWindow * 0.15));
  const usableTokens = Math.max(1, input.contextWindow - reserveTokens);
  return {
    reserveTokens,
    usableTokens,
    ratio: input.estimatedTokens / input.contextWindow,
    pressured: input.estimatedTokens >= Math.floor(input.contextWindow * CONTEXT_PRESSURE_RATIO)
      || input.estimatedTokens >= usableTokens,
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
