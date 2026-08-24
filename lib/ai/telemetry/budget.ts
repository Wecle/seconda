import { z } from "zod";

export type BudgetMode = "off" | "observe" | "enforce";

export type BudgetPolicy = Readonly<{
  mode: BudgetMode;
  taskTokenLimit: number;
}>;

export type BudgetDecision =
  | { action: "allow"; wouldExceed: false }
  | { action: "allow"; wouldExceed: true }
  | { action: "reject"; wouldExceed: true };

type BudgetEnvironment = Record<string, string | undefined>;

const positiveSafeInteger = z.number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

function parseLimit(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const decimal = value.trim();
  if (!/^\d+$/.test(decimal)) throw new Error("Invalid token limit");
  return positiveSafeInteger.parse(Number(decimal));
}

export function loadAIResourcePolicy(
  env: BudgetEnvironment = process.env,
): BudgetPolicy {
  try {
    const mode = z.enum(["off", "observe", "enforce"])
      .parse(env.AI_BUDGET_MODE?.trim() || "observe");
    return {
      mode,
      taskTokenLimit: parseLimit(env.AI_TASK_TOKEN_LIMIT, 500_000),
    };
  } catch {
    throw new Error("AI resource policy is invalid");
  }
}

export function decideBudget(input: {
  mode: BudgetMode;
  usedTokens: number;
  tokenLimit: number;
}): BudgetDecision {
  if (!Number.isSafeInteger(input.usedTokens) || input.usedTokens < 0 ||
    !Number.isSafeInteger(input.tokenLimit) || input.tokenLimit <= 0) {
    throw new Error("AI budget decision input is invalid");
  }
  if (input.mode === "off") return { action: "allow", wouldExceed: false };

  const wouldExceed = input.usedTokens >= input.tokenLimit;
  if (!wouldExceed) return { action: "allow", wouldExceed: false };
  return input.mode === "enforce"
    ? { action: "reject", wouldExceed: true }
    : { action: "allow", wouldExceed: true };
}
