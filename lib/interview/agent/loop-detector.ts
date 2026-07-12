import { createHash } from "node:crypto";

export type ToolCallObservation = {
  toolName: string;
  args: unknown;
  result: unknown;
  progressHash: string;
  unknownTool?: boolean;
  volatileResultFields?: string[];
  phase?: "assessing" | "planning" | "acting";
  phaseProgressId?: string;
};

export type LoopDecision =
  | { level: "continue" }
  | { level: "warning"; warningNumber: 1 | 2; message: string }
  | {
      level: "break";
      reason: "blocking_limit" | "aborted_tools";
      message: string;
    };

type RecordedCall = {
  toolName: string;
  callHash: string;
  resultHash: string;
};

const WARNING_ONE = "检测到重复工具调用，请调整策略。";
const WARNING_TWO = "重复调用仍未产生进展，禁止继续当前策略。";
const BREAK_MESSAGE = "工具调用持续无进展，Agent Run 已被熔断。";

export class AgentLoopDetector {
  private readonly history: RecordedCall[] = [];
  private readonly perToolCount = new Map<string, number>();
  private readonly unknownToolCount = new Map<string, number>();
  private previousProgressHash: string | undefined;
  private noProgressCount = 0;
  private phaseKey: string | undefined;

  record(observation: ToolCallObservation): LoopDecision {
    const phaseKey = `${observation.phase ?? "planning"}:${observation.phaseProgressId ?? "default"}`;
    if (this.phaseKey !== undefined && this.phaseKey !== phaseKey) {
      this.history.length = 0;
      this.unknownToolCount.clear();
      this.previousProgressHash = undefined;
      this.noProgressCount = 0;
    }
    this.phaseKey = phaseKey;
    const callHash = stableHash({
      toolName: observation.toolName,
      args: observation.args,
    });
    const resultHash = stableHash(
      omitFields(observation.result, observation.volatileResultFields ?? []),
    );
    this.history.push({ toolName: observation.toolName, callHash, resultHash });
    if (this.history.length > 30) this.history.shift();

    const toolCount = (this.perToolCount.get(observation.toolName) ?? 0) + 1;
    this.perToolCount.set(observation.toolName, toolCount);

    if (this.previousProgressHash === observation.progressHash) {
      this.noProgressCount += 1;
    } else {
      this.previousProgressHash = observation.progressHash;
      this.noProgressCount = 1;
    }

    if (this.history.length > 12 || toolCount > 6) {
      return breakDecision("blocking_limit");
    }

    if (observation.unknownTool) {
      const count = (this.unknownToolCount.get(observation.toolName) ?? 0) + 1;
      this.unknownToolCount.set(observation.toolName, count);
      const decision = shortThresholdDecision(count, "aborted_tools");
      if (decision.level !== "continue") return decision;
    }

    const pingPongLength = alternatingTailLength(this.history);
    if (pingPongLength >= 8) return breakDecision("blocking_limit");
    if (pingPongLength >= 6) return warningDecision(2);
    if (pingPongLength >= 4) return warningDecision(1);

    const noProgressDecision = shortThresholdDecision(
      this.noProgressCount,
      "blocking_limit",
    );
    if (noProgressDecision.level !== "continue") return noProgressDecision;

    const repeatCount = identicalTailLength(this.history);
    if (repeatCount >= 7) return breakDecision("blocking_limit");
    if (repeatCount >= 5) return warningDecision(2);
    if (repeatCount >= 3) return warningDecision(1);

    return { level: "continue" };
  }
}

function warningDecision(warningNumber: 1 | 2): LoopDecision {
  return {
    level: "warning",
    warningNumber,
    message: warningNumber === 1 ? WARNING_ONE : WARNING_TWO,
  };
}

function breakDecision(
  reason: "blocking_limit" | "aborted_tools",
): LoopDecision {
  return { level: "break", reason, message: BREAK_MESSAGE };
}

function shortThresholdDecision(
  count: number,
  reason: "blocking_limit" | "aborted_tools",
): LoopDecision {
  if (count >= 5) return breakDecision(reason);
  if (count >= 4) return warningDecision(2);
  if (count >= 3) return warningDecision(1);
  return { level: "continue" };
}

function identicalTailLength(history: readonly RecordedCall[]) {
  if (history.length === 0) return 0;
  const last = history.at(-1)!;
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.callHash !== last.callHash || item.resultHash !== last.resultHash) break;
    count += 1;
  }
  return count;
}

function alternatingTailLength(history: readonly RecordedCall[]) {
  if (history.length < 4) return 0;
  let length = 2;
  for (let index = history.length - 3; index >= 0; index -= 1) {
    const current = history[index];
    const twoAhead = history[index + 2];
    const next = history[index + 1];
    if (
      current.callHash !== twoAhead.callHash ||
      current.resultHash !== twoAhead.resultHash ||
      current.callHash === next.callHash
    ) {
      break;
    }
    length += 1;
  }
  return length;
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
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

function omitFields(value: unknown, fields: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => omitFields(item, fields));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !fields.includes(key))
      .map(([key, nested]) => [key, omitFields(nested, fields)]),
  );
}
