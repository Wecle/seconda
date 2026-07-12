import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createInMemoryInterviewAgentRepository } from "./repository";
import {
  executeInterviewTool,
  type InterviewToolDefinition,
  type ToolPipelineHook,
} from "./tool-pipeline";

function fixture(options?: { authorize?: boolean; businessError?: boolean; throws?: boolean }) {
  const order: string[] = [];
  const repository = createInMemoryInterviewAgentRepository();
  const definition: InterviewToolDefinition<{ value: string }, { value: string }> = {
    name: "fixture",
    inputSchema: z.object({ value: z.string() }),
    normalize(input) {
      order.push("normalize");
      return { value: input.value.trim() };
    },
    async validateBusiness() {
      order.push("validateBusiness");
      return options?.businessError
        ? { code: "BUSINESS", message: "blocked", retryable: false }
        : null;
    },
    async authorize() {
      order.push("authorize");
      return options?.authorize ?? true;
    },
    async execute(input) {
      order.push("execute");
      if (options?.throws) throw new Error("secret executor failure");
      return input;
    },
  };
  return { order, repository, definition };
}

test("executes validation, hooks, authorization, execution and persistence in order", async () => {
  const { order, repository, definition } = fixture();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const before: ToolPipelineHook = {
    phase: "before",
    async run(input) {
      order.push("beforeHook");
      return { action: "continue", input: input.input };
    },
  };
  const after: ToolPipelineHook = {
    phase: "after",
    async run(input) {
      order.push("afterHook");
      return { action: "continue", output: input.output };
    },
  };

  const result = await executeInterviewTool({
    definition,
    rawInput: { value: " ok " },
    context: { interviewId: "interview", runId: run.id, repository },
    hooks: [before, after],
  });

  assert.deepEqual(result, { ok: true, output: { value: "ok" } });
  assert.deepEqual(order, ["normalize", "validateBusiness", "beforeHook", "normalize", "authorize", "execute", "afterHook"]);
  assert.equal(repository.inspectRun(run.id)?.eventSequence, 2);
});

test("rejects malformed enum input before business logic", async () => {
  const { order, repository, definition } = fixture();
  definition.inputSchema = z.object({ value: z.enum(["allowed"]) });
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await executeInterviewTool({
    definition,
    rawInput: { value: "denied" },
    context: { interviewId: "interview", runId: run.id, repository },
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.error.code, "INVALID_TOOL_INPUT");
  assert.deepEqual(order, []);
  const events = await repository.listEvents(run.id, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "tool_call_completed");
  assert.equal((events[0]?.payload as { result?: { error?: { code?: string } } }).result?.error?.code, "INVALID_TOOL_INPUT");
});

test("returns structured business errors without authorization or execution", async () => {
  const { order, repository, definition } = fixture({ businessError: true });
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await executeInterviewTool({ definition, rawInput: { value: "x" }, context: { interviewId: "interview", runId: run.id, repository } });
  assert.deepEqual(result, { ok: false, error: { code: "BUSINESS", message: "blocked", retryable: false } });
  assert.deepEqual(order, ["normalize", "validateBusiness"]);
  assert.equal(repository.inspectRun(run.id)?.eventSequence, 1);
});

test("stops at a before hook", async () => {
  const { order, repository, definition } = fixture();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await executeInterviewTool({
    definition,
    rawInput: { value: "x" },
    context: { interviewId: "interview", runId: run.id, repository },
    hooks: [{ phase: "before", async run() { order.push("beforeHook"); return { action: "stop", message: "hook blocked" }; } }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.error.code, "HOOK_STOPPED");
  assert.deepEqual(order, ["normalize", "validateBusiness", "beforeHook"]);
});

test("denies unauthorized tools before execution", async () => {
  const { order, repository, definition } = fixture({ authorize: false });
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await executeInterviewTool({ definition, rawInput: { value: "x" }, context: { interviewId: "interview", runId: run.id, repository } });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.error.code, "TOOL_PERMISSION_DENIED");
  assert.deepEqual(order, ["normalize", "validateBusiness", "authorize"]);
  assert.equal(repository.inspectRun(run.id)?.eventSequence, 1);
});

test("sanitizes executor failures before returning and persisting", async () => {
  const { repository, definition } = fixture({ throws: true });
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await executeInterviewTool({ definition, rawInput: { value: "x" }, context: { interviewId: "interview", runId: run.id, repository } });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.error.code, "TOOL_EXECUTION_FAILED");
  assert.equal(result.ok ? false : result.error.message.includes("secret"), false);
  assert.equal(repository.inspectRun(run.id)?.eventSequence, 2);
});
