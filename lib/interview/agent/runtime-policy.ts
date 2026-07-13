export const MAX_PLANNING_STEPS = 15;
export const MAX_TERMINAL_ATTEMPTS = 3;
export const MAX_INVALID_MODEL_ACTIONS = 3;

export type RuntimePhase = "planning" | "terminal";

const TERMINAL_TOOL_NAMES = new Set([
  "ask_interview_question",
  "finish_interview",
]);

export function isTerminalTool(name: string) {
  return TERMINAL_TOOL_NAMES.has(name);
}

export function toolsForRuntimePhase<T>(
  tools: ReadonlyMap<string, T>,
  phase: RuntimePhase,
) {
  return phase === "planning"
    ? new Map(tools)
    : new Map([...tools].filter(([name]) => isTerminalTool(name)));
}
