import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { AgentModelStep } from "./contracts";
import { createInMemoryInterviewAgentRepository } from "./repository";
import type { InterviewToolDefinition } from "./tool-pipeline";
import { runInterviewAgent } from "./runtime";

function tool(name: string): InterviewToolDefinition<unknown, unknown> {
  return {
    name,
    inputSchema: z.unknown(),
    normalize: (input) => input,
    validateBusiness: async () => null,
    authorize: async () => true,
    execute: async (input) => ({ accepted: true, input }),
  };
}

async function fixture(steps: AgentModelStep[], tools = [tool("get_coverage_state"), tool("ask_interview_question"), tool("finish_interview")]) {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  let index = 0;
  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: { async nextStep() { return steps[index++] ?? { type: "final", content: "invalid final" }; } },
    tools: new Map(tools.map((definition) => [definition.name, definition])),
    initialMessages: [{ role: "user", content: "start" }],
    signal: new AbortController().signal,
    progressHash: () => "same",
  });
  return { result, repository, run, modelCalls: index };
}

test("completes after a domain tool commits a candidate-visible outcome", async () => {
  const { result, repository, run } = await fixture([
    { type: "tool_call", callId: "1", toolName: "get_coverage_state", args: {} },
    { type: "tool_call", callId: "2", toolName: "ask_interview_question", args: { question: "请自我介绍" } },
  ]);
  assert.equal(result.exitReason, "completed");
  assert.equal(repository.inspectRun(run.id)?.status, "completed");
});

test("exits after eight model turns without a committed outcome", async () => {
  const steps = Array.from({ length: 8 }, (_, index) => ({
    type: "final" as const,
    content: `uncommitted-${index}`,
  }));
  const { result } = await fixture(steps);
  assert.equal(result.exitReason, "max_turns");
});

test("allows two retryable tool argument repairs outside the productive turn budget", async () => {
  const strictTool = tool("get_coverage_state");
  strictTool.inputSchema = z.object({ required: z.string() });
  const steps = [
    { type: "tool_call" as const, callId: "bad-1", toolName: "get_coverage_state", args: {} },
    { type: "tool_call" as const, callId: "bad-2", toolName: "get_coverage_state", args: {} },
    ...Array.from({ length: 8 }, (_, index) => ({ type: "final" as const, content: `final-${index}` })),
  ];
  const { result, modelCalls } = await fixture(steps, [strictTool]);
  assert.equal(result.exitReason, "max_turns");
  assert.equal(result.turnCount, 8);
  assert.equal(modelCalls, 10);
});

test("breaks after a third retryable tool argument failure", async () => {
  const strictTool = tool("get_coverage_state");
  strictTool.inputSchema = z.object({ required: z.string() });
  const steps = Array.from({ length: 3 }, (_, index) => ({
    type: "tool_call" as const,
    callId: `bad-${index}`,
    toolName: "get_coverage_state",
    args: {},
  }));
  const { result, modelCalls } = await fixture(steps, [strictTool]);
  assert.equal(result.exitReason, "blocking_limit");
  assert.equal(modelCalls, 3);
});

test("completes a grounded opening after bounded evidence reads", async () => {
  const { result, modelCalls } = await fixture([
    { type: "tool_call", callId: "coverage", toolName: "get_coverage_state", args: {} },
    { type: "tool_call", callId: "evidence", toolName: "get_resume_evidence", args: { evidenceIds: ["profile:1"] } },
    { type: "tool_call", callId: "ask", toolName: "ask_interview_question", args: { question: "请自我介绍？" } },
  ], [tool("get_coverage_state"), tool("get_resume_evidence"), tool("ask_interview_question")]);
  assert.equal(result.exitReason, "completed");
  assert.equal(modelCalls, 3);
});

test("feeds loop warnings back to the model and then breaks", async () => {
  const steps = Array.from({ length: 8 }, (_, index) => ({
    type: "tool_call" as const,
    callId: String(index),
    toolName: index % 2 === 0 ? "get_coverage_state" : "other_read",
    args: {},
  }));
  const other = tool("other_read");
  const { result, repository, run } = await fixture(steps, [tool("get_coverage_state"), other]);
  assert.equal(result.exitReason, "blocking_limit");
  assert.equal((repository.inspectRun(run.id)?.eventSequence ?? 0) > 8, true);
});

test("maps a stopped tool hook to hook_stopped", async () => {
  const definition = tool("ask_interview_question");
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: { async nextStep() { return { type: "tool_call", callId: "1", toolName: definition.name, args: {} }; } },
    tools: new Map([[definition.name, definition]]),
    hooks: [{ phase: "before", async run() { return { action: "stop", message: "stop" }; } }],
    initialMessages: [],
    signal: new AbortController().signal,
    progressHash: () => "same",
  });
  assert.equal(result.exitReason, "hook_stopped");
});

test("maps an abort during tool execution to aborted_tools", async () => {
  const controller = new AbortController();
  const definition = tool("get_coverage_state");
  definition.execute = async () => {
    controller.abort(new DOMException("Aborted", "AbortError"));
    throw controller.signal.reason;
  };
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: { async nextStep() { return { type: "tool_call", callId: "1", toolName: definition.name, args: {} }; } },
    tools: new Map([[definition.name, definition]]),
    initialMessages: [],
    signal: controller.signal,
    progressHash: () => "same",
  });
  assert.equal(result.exitReason, "aborted_tools");
});

test("commits the same message identity used by provisional deltas", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const definition = tool("ask_interview_question");
  definition.execute = async (_input, context) => {
    const message = await context.repository.appendMessage({
      id: context.provisionalMessageId,
      interviewId: context.interviewId,
      runId: context.runId,
      role: "assistant",
      kind: "question",
      content: "请自我介绍",
    });
    return { messageId: message.id, messageSequence: message.sequence, responseText: "你的回答说明了缓存策略。\n\n请介绍一次缓存失效问题？" };
  };
  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: {
      async nextStep() { throw new Error("non-streaming path should not run"); },
      async nextStepStream(input) {
        await input.onProvisionalDelta({ messageId: "message-stable", attemptId: "attempt-1", text: "请自我介绍" });
        return {
          step: { type: "tool_call", callId: "1", toolName: "ask_interview_question", args: {} },
          attemptId: "attempt-1",
          provisionalMessageId: "message-stable",
        };
      },
    },
    tools: new Map([[definition.name, definition]]),
    initialMessages: [],
    signal: new AbortController().signal,
    progressHash: () => "progress",
  });
  assert.equal(result.exitReason, "completed");
  const events = await repository.listEvents(run.id, 0);
  assert.equal((events.find((event) => event.type === "text_delta")?.payload as { messageId: string }).messageId, "message-stable");
  assert.equal((events.find((event) => event.type === "message_committed")?.payload as { messageId: string }).messageId, "message-stable");
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("response_started") < types.indexOf("text_delta"));
  assert.ok(types.indexOf("text_delta") < types.indexOf("message_committed"));
});

test("caps actual provider attempts across logical model calls", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "attempt-cap" });
  let attempts = 0;
  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: {
      async nextStep() { throw new Error("unused"); },
      async nextStepStream(input) {
        for (let index = 0; index < 3; index += 1) {
          attempts += 1;
          await input.onAttemptStarted?.({
            model: "fast",
            attemptId: `attempt-${attempts}`,
            attemptNumber: attempts,
            provisionalMessageId: `message-${index}`,
          });
        }
        return {
          step: { type: "final" as const, content: "internal" },
          attemptId: "selected",
          provisionalMessageId: null,
        };
      },
    },
    tools: new Map([["get_coverage_state", tool("get_coverage_state")]]),
    initialMessages: [],
    signal: new AbortController().signal,
    progressHash: () => "same",
  });
  assert.equal(result.exitReason, "max_turns");
  assert.equal(attempts, 11);
});

test("attributes synthesized response deltas to the selected attempt", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "selected-attempt" });
  const definition = tool("ask_interview_question");
  definition.execute = async (_input, context) => {
    const message = await context.repository.appendMessage({
      id: context.provisionalMessageId,
      interviewId: context.interviewId,
      runId: context.runId,
      role: "assistant",
      kind: "question",
      content: "请自我介绍？",
    });
    return { messageId: message.id, messageSequence: message.sequence, responseText: "请自我介绍？" };
  };
  await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: {
      async nextStep() { throw new Error("unused"); },
      async nextStepStream(input) {
        await input.onProvisionalDelta({ messageId: "failed-message", attemptId: "failed-attempt", text: "失败" });
        await input.onProvisionalDelta({ messageId: "selected-message", attemptId: "selected-attempt", text: "成功" });
        return {
          step: { type: "tool_call" as const, callId: "call", toolName: "ask_interview_question", args: {} },
          attemptId: "selected-attempt",
          provisionalMessageId: "selected-message",
        };
      },
    },
    tools: new Map([[definition.name, definition]]),
    initialMessages: [],
    signal: new AbortController().signal,
    progressHash: () => "same",
  });
  const deltas = (await repository.listEvents(run.id, 0)).filter((event) => event.type === "text_delta");
  assert.ok(deltas.length > 0);
  assert.ok(deltas.every((event) => (event.payload as { attemptId: string }).attemptId === "selected-attempt"));
});
