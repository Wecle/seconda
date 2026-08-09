import assert from "node:assert/strict";
import test from "node:test";
import type { AIOperationsReport } from "../lib/operations/ai-operations";
import {
  parseAIOperationsArgs,
  renderAIOperationsJSON,
  renderAIOperationsText,
} from "./ai-operations-cli";

const emptySections: AIOperationsReport["sections"] = {
  summary: null,
  distribution: [],
  failures: [],
  slow: [],
  cache: [],
  completion: [],
  budgets: [],
  dataQuality: null,
  interview: null,
};

function report(
  sections: Partial<AIOperationsReport["sections"]> = {},
): AIOperationsReport {
  return {
    version: 1,
    generatedAt: "2026-08-03T12:00:00.000Z",
    window: {
      since: "2026-08-02T12:00:00.000Z",
      until: "2026-08-03T12:00:00.000Z",
    },
    sections: { ...emptySections, ...sections },
  };
}

test("parses the default complete report and focused options", () => {
  assert.deepEqual(parseAIOperationsArgs([]), {
    command: "all",
    sinceMs: 86_400_000,
    limit: 20,
    json: false,
  });
  assert.deepEqual(
    parseAIOperationsArgs(["failures", "--since", "7d", "--limit", "50", "--json"]),
    {
      command: "failures",
      sinceMs: 604_800_000,
      limit: 50,
      json: true,
    },
  );
  assert.deepEqual(parseAIOperationsArgs(["--json"]), {
    command: "all",
    sinceMs: 86_400_000,
    limit: 20,
    json: true,
  });
  assert.deepEqual(parseAIOperationsArgs(["--", "summary"]), {
    command: "summary",
    sinceMs: 86_400_000,
    limit: 20,
    json: false,
  });
  assert.deepEqual(parseAIOperationsArgs(["--", "--json"]), {
    command: "all",
    sinceMs: 86_400_000,
    limit: 20,
    json: true,
  });
});

test("parses every focused command and validates interview UUIDs", () => {
  for (const command of ["summary", "failures", "slow", "cache", "completion", "budgets"] as const) {
    assert.equal(parseAIOperationsArgs([command]).command, command);
  }

  const interviewId = "6c299bb0-99be-4a3f-977f-a06ef8d80bb7";
  assert.deepEqual(parseAIOperationsArgs(["interview", interviewId]), {
    command: "interview",
    interviewId,
    sinceMs: 86_400_000,
    limit: 20,
    json: false,
  });
});

test("rejects invalid commands, values, durations, limits, and UUIDs", () => {
  const invalidInputs = [
    ["wat"],
    ["summary", "extra"],
    ["--since"],
    ["--limit"],
    ["summary", "--since", "0h"],
    ["summary", "--since", "-1h"],
    ["summary", "--since", "1w"],
    ["summary", "--since", "1.5h"],
    ["summary", "--limit", "0"],
    ["summary", "--limit", "-1"],
    ["summary", "--limit", "501"],
    ["summary", "--limit", "1.5"],
    ["summary", "--unknown"],
    ["interview"],
    ["interview", "not-a-uuid"],
  ];

  for (const input of invalidInputs) {
    assert.throws(() => parseAIOperationsArgs(input), /Usage:/);
  }
});

test("renders every all-report heading in the required order and empty data explicitly", () => {
  const output = renderAIOperationsText(report(), "all");
  const headings = [
    "AI Operations Overview",
    "Task and Model Distribution",
    "Failures and Fallbacks",
    "Slow Operations",
    "Cache Efficiency",
    "Completion Health",
    "Budget Warnings",
    "Data Quality",
  ];

  let previous = -1;
  for (const heading of headings) {
    const index = output.indexOf(heading);
    assert.ok(index > previous, `${heading} must follow the prior heading`);
    previous = index;
  }
  assert.match(output, /No data/);
});

test("renders unknown cost and unavailable cache data without replacing them with zero", () => {
  const output = renderAIOperationsText(report({
    summary: {
      taskRuns: 1,
      attempts: 1,
      completedTasks: 1,
      failedTasks: 0,
      inputTokens: 12,
      outputTokens: 3,
      knownCostMicros: null,
    },
    cache: [{
      task: "answer.score",
      model: "model-a",
      promptTemplateVersion: null,
      availableSamples: 0,
      unavailableSamples: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadRatio: null,
    }],
  }), "all");

  assert.match(output, /Known cost: unknown/);
  assert.match(output, /Cache read ratio: unavailable/);
});

test("renders one versioned JSON object", () => {
  const value = JSON.parse(renderAIOperationsJSON(report()));
  assert.equal(value.version, 1);
  assert.equal(value.generatedAt, "2026-08-03T12:00:00.000Z");
  assert.deepEqual(value.window, {
    since: "2026-08-02T12:00:00.000Z",
    until: "2026-08-03T12:00:00.000Z",
  });
  assert.deepEqual(value.sections, emptySections);
});
