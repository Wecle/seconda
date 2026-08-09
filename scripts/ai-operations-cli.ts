import type {
  AIOperationsCommand,
  AIOperationsReport,
} from "../lib/operations/ai-operations";

export type AIOperationsArguments = {
  command: AIOperationsCommand;
  sinceMs: number;
  limit: number;
  json: boolean;
  interviewId?: string;
};

const commands = new Set<AIOperationsCommand>([
  "all",
  "summary",
  "failures",
  "slow",
  "cache",
  "completion",
  "budgets",
  "interview",
]);

export const AI_OPERATIONS_USAGE = `Usage: pnpm ops:ai -- [command] [options]

Commands:
  summary
  failures
  slow
  cache
  completion
  budgets
  interview <interview-id>

Options:
  --since <duration>  Positive integer followed by m, h, or d (default: 24h)
  --limit <integer>   Detail row limit from 1 through 500 (default: 20)
  --json              Emit a versioned JSON report`;

function usageError(): never {
  throw new Error(AI_OPERATIONS_USAGE);
}

function parseDuration(value: string | undefined): number {
  const match = value?.match(/^(\d+)([mhd])$/);
  if (!match) return usageError();
  const quantity = Number(match[1]);
  const unitMs = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
  const duration = quantity * unitMs;
  if (quantity <= 0 || !Number.isSafeInteger(duration)) return usageError();
  return duration;
}

function parseLimit(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return usageError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) return usageError();
  return limit;
}

function isUUID(value: string | undefined): value is string {
  return value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseAIOperationsArgs(args: readonly string[]): AIOperationsArguments {
  if (args[0] === "--") return parseAIOperationsArgs(args.slice(1));

  let command: AIOperationsCommand = "all";
  let sinceMs = 86_400_000;
  let limit = 20;
  let json = false;
  let interviewId: string | undefined;
  let index = 0;

  if (args[0] && !args[0].startsWith("--")) {
    if (!commands.has(args[0] as AIOperationsCommand)) return usageError();
    command = args[0] as AIOperationsCommand;
    index = 1;
    if (command === "interview") {
      if (!isUUID(args[index])) return usageError();
      interviewId = args[index];
      index += 1;
    }
  }

  while (index < args.length) {
    const option = args[index];
    if (option === "--json") {
      json = true;
      index += 1;
      continue;
    }
    if (option === "--since") {
      sinceMs = parseDuration(args[index + 1]);
      index += 2;
      continue;
    }
    if (option === "--limit") {
      limit = parseLimit(args[index + 1]);
      index += 2;
      continue;
    }
    return usageError();
  }

  return {
    command,
    ...(interviewId ? { interviewId } : {}),
    sinceMs,
    limit,
    json,
  };
}

function cost(value: number | null): string {
  return value === null ? "unknown" : `${value} micros`;
}

function rate(value: number | null): string {
  return value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
}

function section(title: string, lines: readonly string[]): string {
  return `${title}\n${lines.length === 0 ? "No data" : lines.join("\n")}`;
}

function renderSummary(report: AIOperationsReport): string {
  const value = report.sections.summary;
  if (!value) return section("AI Operations Overview", []);
  const taskRate = value.taskRuns === 0
    ? "unavailable"
    : `${(value.completedTasks / value.taskRuns * 100).toFixed(1)}%`;
  return section("AI Operations Overview", [
    `Window: ${report.window.since} to ${report.window.until}`,
    `Task runs: ${value.taskRuns}`,
    `Attempts: ${value.attempts}`,
    `Task success rate: ${taskRate}`,
    `Input tokens: ${value.inputTokens}`,
    `Output tokens: ${value.outputTokens}`,
    `Known cost: ${cost(value.knownCostMicros)}`,
  ]);
}

function renderDistribution(report: AIOperationsReport): string {
  return section("Task and Model Distribution", report.sections.distribution.map((row) =>
    `${row.task} | ${row.provider}/${row.model} | tasks ${row.taskRuns} | attempts ${row.attempts} | success ${rate(row.successRate)} | tokens ${row.inputTokens}/${row.outputTokens} | cost ${cost(row.knownCostMicros)}`,
  ));
}

function renderFailures(report: AIOperationsReport): string {
  return section("Failures and Fallbacks", report.sections.failures.map((row) =>
    `${row.task} | ${row.provider}/${row.model} | ${row.errorCategory ?? "uncategorized"} | retryable ${row.retryable ?? "unknown"} | count ${row.count}`,
  ));
}

function renderSlow(report: AIOperationsReport): string {
  return section("Slow Operations", report.sections.slow.map((row) =>
    `${row.startedAt} | ${row.task} | ${row.model} | first token ${row.firstTokenMs ?? "unavailable"} ms | duration ${row.durationMs ?? "unavailable"} ms | task ${row.taskRunId} | attempt ${row.attemptId}`,
  ));
}

function renderCache(report: AIOperationsReport): string {
  return section("Cache Efficiency", report.sections.cache.map((row) =>
    `${row.task} | ${row.model} | template ${row.promptTemplateVersion ?? "unavailable"} | samples ${row.availableSamples}/${row.unavailableSamples} | tokens ${row.inputTokens}/${row.cachedInputTokens}/${row.cacheWriteTokens} | Cache read ratio: ${rate(row.cacheReadRatio)}`,
  ));
}

function renderCompletion(report: AIOperationsReport): string {
  return section("Completion Health", report.sections.completion.map((row) =>
    `${row.completionJobId} | interview ${row.interviewId} | ${row.status} | execution attempts ${row.executionAttempts} | scores ${row.scoredQuestions}/${row.requiredQuestions} | failed ${row.failedQuestions} | duration ${row.durationMs ?? "unavailable"} ms | cost ${cost(row.knownCostMicros)}`,
  ));
}

function renderBudgets(report: AIOperationsReport): string {
  return section("Budget Warnings", report.sections.budgets.map((row) =>
    `${row.startedAt} | ${row.task} | ${row.budgetScope} | ${row.budgetMode} | tokens ${row.usedTokens}/${row.tokenLimit} | ${row.rejected ? "rejected" : "warning"} | task ${row.taskRunId}`,
  ));
}

function renderDataQuality(report: AIOperationsReport): string {
  const value = report.sections.dataQuality;
  if (!value) return section("Data Quality", []);
  return section("Data Quality", [
    `Usage unavailable attempts: ${value.usageUnavailableAttempts}`,
    `Cache unavailable attempts: ${value.cacheUnavailableAttempts}`,
    `Unpriced attempts: ${value.unpricedAttempts}`,
  ]);
}

function renderInterview(report: AIOperationsReport): string {
  const value = report.sections.interview;
  if (!value) return section("Interview Observability", []);
  return section("Interview Observability", [
    `Interview: ${value.interviewId}`,
    `Agent runs: ${value.agentRuns}`,
    `Failed runs: ${value.failedRuns}`,
    `Fallback attempts: ${value.fallbackAttempts}`,
    `Recovery count: ${value.resumeCount}`,
    `Input tokens: ${value.inputTokens}`,
    `Output tokens: ${value.outputTokens}`,
    `Known cost: ${cost(value.knownCostMicros)}`,
    `Unpriced attempts: ${value.unpricedAttempts}`,
    `Usage unavailable attempts: ${value.usageUnavailableAttempts}`,
    `Completion duration: ${value.completionDurationMs ?? "unavailable"} ms`,
  ]);
}

export function renderAIOperationsText(
  report: AIOperationsReport,
  command: AIOperationsCommand,
): string {
  if (command === "all") {
    return [
      renderSummary(report),
      renderDistribution(report),
      renderFailures(report),
      renderSlow(report),
      renderCache(report),
      renderCompletion(report),
      renderBudgets(report),
      renderDataQuality(report),
    ].join("\n\n");
  }
  if (command === "summary") {
    return [renderSummary(report), renderDistribution(report), renderDataQuality(report)].join("\n\n");
  }
  if (command === "failures") return renderFailures(report);
  if (command === "slow") return renderSlow(report);
  if (command === "cache") return renderCache(report);
  if (command === "completion") return renderCompletion(report);
  if (command === "budgets") return renderBudgets(report);
  return renderInterview(report);
}

export function renderAIOperationsJSON(report: AIOperationsReport): string {
  return JSON.stringify(report, null, 2);
}
