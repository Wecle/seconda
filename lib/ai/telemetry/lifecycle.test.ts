import assert from "node:assert/strict";
import test from "node:test";
import {
  AIResourceBudgetError,
  createAITelemetryLifecycle,
} from "./lifecycle";
import type {
  AITelemetryRepository,
  CompleteAttemptInput,
  FailAttemptInput,
  StartAttemptInput,
  StartTaskInput,
} from "./repository";
import { isAttemptUnpriced } from "./repository";

function repository(overrides: Partial<AITelemetryRepository> = {}) {
  const calls: {
    starts: StartTaskInput[];
    attempts: StartAttemptInput[];
    completions: CompleteAttemptInput[];
    failures: FailAttemptInput[];
  } = { starts: [], attempts: [], completions: [], failures: [] };
  const value: AITelemetryRepository = {
    async startOrResumeTask(input) {
      calls.starts.push(input);
      return { id: "task-1", budgetMode: input.budgetMode, tokenLimit: input.tokenLimit };
    },
    async startAttempt(input) {
      calls.attempts.push(input);
      return {
        id: "attempt-1",
        taskRunId: input.taskRunId,
        attemptNumber: input.requestedAttemptNumber,
        rejected: false,
        wouldExceed: false,
      };
    },
    async completeAttempt(input) {
      calls.completions.push(input);
    },
    async failAttempt(input) {
      calls.failures.push(input);
    },
    async completeTask() {},
    async failTask() {},
    ...overrides,
  };
  return { value, calls };
}

const context = {
  operationKey: "lifecycle-test-operation",
  budgetScope: "agent_run:00000000-0000-0000-0000-000000000001" as const,
};

test("records a priced task and provider attempt without content fields", async () => {
  const repo = repository();
  const lifecycle = createAITelemetryLifecycle({
    repository: repo.value,
    policy: { mode: "observe", agentRunTokenLimit: 123, completionTokenLimit: 456 },
    pricing: {
      version: 1,
      models: {
        "openai/test": {
          inputMicrosPerMillion: 1_000_000,
          outputMicrosPerMillion: 2_000_000,
        },
      },
    },
    now: () => 10,
  });
  const task = await lifecycle.startTask({ task: "interview.agent", context });
  const attempt = await lifecycle.beforeAttempt({
    task,
    attemptNumber: 1,
    model: "openai/test",
    credentialTier: "fast",
  });
  await lifecycle.completeAttempt({
    attempt,
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      cachedInputTokens: null,
      cacheWriteTokens: null,
    },
    firstTokenMs: 4,
    durationMs: 9,
  });

  assert.equal(task.tokenLimit, 123);
  assert.equal(attempt.provider, "openai");
  assert.equal(attempt.startedAtMs, 10);
  assert.equal(repo.calls.starts.length, 1);
  assert.equal(repo.calls.attempts.length, 1);
  assert.equal(repo.calls.completions[0].estimatedCostMicros, 120);
  assert.doesNotMatch(JSON.stringify(repo.calls), /prompt|response|answer|resume/i);
});

test("observe mode turns start persistence failures into no-op handles", async (t) => {
  t.mock.method(console, "error", () => {});
  const repo = repository({
    async startOrResumeTask() {
      throw new Error("database connection includes private details");
    },
  });
  const lifecycle = createAITelemetryLifecycle({
    repository: repo.value,
    policy: { mode: "observe", agentRunTokenLimit: 10, completionTokenLimit: 10 },
  });
  const task = await lifecycle.startTask({ task: "interview.agent", context });
  const attempt = await lifecycle.beforeAttempt({
    task,
    attemptNumber: 1,
    model: "openai/test",
    credentialTier: "fast",
  });
  assert.equal(task.noOp, true);
  assert.equal(attempt.noOp, true);
  assert.equal(repo.calls.attempts.length, 0);
  const logged = (console.error as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } })
    .mock.calls[0].arguments;
  assert.equal(logged[0], "AI telemetry operation failed");
  assert.deepEqual(logged[1], {
    operation: "start_task",
    task: "interview.agent",
    category: "unknown",
  });
});

test("attempt and task completion persistence failures never replace business errors", async (t) => {
  t.mock.method(console, "error", () => {});
  const repo = repository({
    async failAttempt() {
      throw new Error("write failed");
    },
    async failTask() {
      throw new Error("write failed");
    },
  });
  const lifecycle = createAITelemetryLifecycle({
    repository: repo.value,
    policy: { mode: "observe", agentRunTokenLimit: 10, completionTokenLimit: 10 },
  });
  const task = await lifecycle.startTask({ task: "resume.parse", context: {
    operationKey: "failure-isolation",
  } });
  const attempt = await lifecycle.beforeAttempt({
    task,
    attemptNumber: 1,
    model: "openai/test",
    credentialTier: "fast",
  });
  const businessError = new Error("candidate content must not be logged");
  await assert.doesNotReject(lifecycle.failAttempt({
    attempt,
    error: businessError,
    usage: null,
    firstTokenMs: null,
    durationMs: 1,
  }));
  await assert.doesNotReject(lifecycle.failTask(task, businessError));
  assert.doesNotMatch(JSON.stringify(
    (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
  ), /candidate content/);
});

test("enforce mode fails closed when task start or budget read is unavailable", async (t) => {
  t.mock.method(console, "error", () => {});
  let providerCalls = 0;
  const unavailableStart = repository({
    async startOrResumeTask() {
      throw new Error("unavailable");
    },
  });
  const startLifecycle = createAITelemetryLifecycle({
    repository: unavailableStart.value,
    policy: { mode: "enforce", agentRunTokenLimit: 10, completionTokenLimit: 10 },
  });
  await assert.rejects(
    startLifecycle.startTask({ task: "interview.agent", context }),
    (error) => error instanceof AIResourceBudgetError
      && error.code === "AI_RESOURCE_BUDGET_UNAVAILABLE",
  );

  const unavailableBudget = repository({
    async startAttempt() {
      throw new Error("budget read unavailable");
    },
  });
  const attemptLifecycle = createAITelemetryLifecycle({
    repository: unavailableBudget.value,
    policy: { mode: "enforce", agentRunTokenLimit: 10, completionTokenLimit: 10 },
  });
  const task = await attemptLifecycle.startTask({ task: "interview.agent", context });
  await assert.rejects(
    attemptLifecycle.beforeAttempt({
      task,
      attemptNumber: 1,
      model: "openai/test",
      credentialTier: "fast",
    }).then(() => {
      providerCalls += 1;
    }),
    (error) => error instanceof AIResourceBudgetError
      && error.code === "AI_RESOURCE_BUDGET_UNAVAILABLE",
  );
  assert.equal(providerCalls, 0);
});

test("enforce mode blocks the next attempt after terminal Usage persistence fails", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const terminal of ["complete", "fail"] as const) {
    const repo = repository({
      async completeAttempt() {
        if (terminal === "complete") throw new Error("write unavailable");
      },
      async failAttempt() {
        if (terminal === "fail") throw new Error("write unavailable");
      },
    });
    const lifecycle = createAITelemetryLifecycle({
      repository: repo.value,
      policy: { mode: "enforce", agentRunTokenLimit: 10, completionTokenLimit: 10 },
    });
    const task = await lifecycle.startTask({ task: "interview.agent", context });
    const attempt = await lifecycle.beforeAttempt({
      task,
      attemptNumber: 1,
      model: "openai/test",
      credentialTier: "fast",
    });
    const terminalWrite = terminal === "complete"
      ? lifecycle.completeAttempt({
          attempt,
          usage: null,
          firstTokenMs: null,
          durationMs: 1,
        })
      : lifecycle.failAttempt({
          attempt,
          error: new Error("business failure"),
          usage: null,
          firstTokenMs: null,
          durationMs: 1,
        });
    await assert.doesNotReject(terminalWrite);
    await assert.rejects(lifecycle.beforeAttempt({
      task,
      attemptNumber: 2,
      model: "openai/test",
      credentialTier: "fast",
    }), (error) => error instanceof AIResourceBudgetError
      && error.code === "AI_RESOURCE_BUDGET_UNAVAILABLE");
    assert.equal(repo.calls.attempts.length, 1);
  }
});

test("budget rejection exposes only the stable exceeded error code", async () => {
  const repo = repository({
    async startAttempt(input) {
      return {
        id: "rejected-attempt",
        taskRunId: input.taskRunId,
        attemptNumber: input.requestedAttemptNumber,
        rejected: true,
        wouldExceed: true,
      };
    },
  });
  const lifecycle = createAITelemetryLifecycle({
    repository: repo.value,
    policy: { mode: "enforce", agentRunTokenLimit: 10, completionTokenLimit: 10 },
  });
  const task = await lifecycle.startTask({ task: "interview.agent", context });
  await assert.rejects(
    lifecycle.beforeAttempt({
      task,
      attemptNumber: 1,
      model: "openai/test",
      credentialTier: "fast",
    }),
    (error) => error instanceof AIResourceBudgetError
      && error.code === "AI_RESOURCE_BUDGET_EXCEEDED"
      && error.message === "AI_RESOURCE_BUDGET_EXCEEDED",
  );
});

test("off mode records telemetry while disabling budget decisions", async () => {
  const repo = repository();
  const lifecycle = createAITelemetryLifecycle({
    repository: repo.value,
    policy: { mode: "off", agentRunTokenLimit: 10, completionTokenLimit: 10 },
  });
  const task = await lifecycle.startTask({ task: "resume.generate", context: {
    operationKey: "off-mode",
  } });
  assert.equal(task.noOp, false);
  assert.equal(task.budgetMode, "off");
  assert.equal(repo.calls.starts.length, 1);
});

test("unpriced classification depends on required price snapshots, not null calculated cost", () => {
  const baseUsage = {
    inputTokens: 2,
    outputTokens: 1,
    cachedInputTokens: null,
    cacheWriteTokens: null,
  };
  const completePrice = {
    inputMicrosPerMillion: Number.MAX_SAFE_INTEGER,
    outputMicrosPerMillion: Number.MAX_SAFE_INTEGER,
    cacheReadMicrosPerMillion: 1,
    cacheWriteMicrosPerMillion: 1,
  };
  assert.equal(isAttemptUnpriced(null, null), false);
  assert.equal(isAttemptUnpriced(baseUsage, null), true);
  assert.equal(isAttemptUnpriced(baseUsage, completePrice), false);
  assert.equal(isAttemptUnpriced({
    ...baseUsage,
    cachedInputTokens: 3,
  }, completePrice), false);
  assert.equal(isAttemptUnpriced({
    ...baseUsage,
    cachedInputTokens: 1,
  }, {
    inputMicrosPerMillion: 1,
    outputMicrosPerMillion: 1,
  }), true);
  assert.equal(isAttemptUnpriced({
    ...baseUsage,
    cacheWriteTokens: 1,
  }, {
    inputMicrosPerMillion: 1,
    outputMicrosPerMillion: 1,
  }), true);
});
