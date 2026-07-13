import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { AgentModelStep } from "./contracts";
import { createInMemoryInterviewAgentRepository } from "./repository";
import type { InterviewToolDefinition } from "./tool-pipeline";
import { runInterviewAgent } from "./runtime";
import { createInterviewToolRegistry } from "./tool-registry";

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

async function fixture(
  steps: AgentModelStep[],
  tools = [tool("get_coverage_state"), tool("ask_interview_question"), tool("finish_interview")],
  options: { progressHash?: (modelCalls: number) => string } = {},
) {
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
    progressHash: () => options.progressHash?.(index) ?? "same",
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

test("enters terminal phase after fifteen planning tools and still asks", async () => {
  const planning = Array.from({ length: 15 }, (_, index) => ({
    type: "tool_call" as const,
    callId: `plan-${index}`,
    toolName: ["get_coverage_state", "get_interview_history", "get_resume_evidence"][index % 3],
    args: { index },
  }));
  const { result, modelCalls } = await fixture([
    ...planning,
    { type: "tool_call", callId: "ask", toolName: "ask_interview_question", args: {} },
  ], [
    tool("get_coverage_state"),
    tool("get_interview_history"),
    tool("get_resume_evidence"),
    tool("ask_interview_question"),
    tool("finish_interview"),
  ], { progressHash: String });
  assert.equal(result.exitReason, "completed");
  assert.equal(result.turnCount, 15);
  assert.equal(modelCalls, 16);
});

test("keeps terminal-only tools after planning exhaustion and a failed terminal action", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "terminal-boundary" });
  const ask = tool("ask_interview_question");
  ask.validateBusiness = async () => ({
    code: "MISSING_EVIDENCE",
    message: "missing",
    retryable: false,
  });
  const planning = Array.from({ length: 15 }, (_, index) => ({
    type: "tool_call" as const,
    callId: `plan-${index}`,
    toolName: ["get_coverage_state", "get_interview_history", "get_resume_evidence"][index % 3],
    args: { index },
  }));
  const steps: AgentModelStep[] = [
    ...planning,
    { type: "tool_call", callId: "ask-failed", toolName: "ask_interview_question", args: {} },
    { type: "tool_call", callId: "finish", toolName: "finish_interview", args: {} },
  ];
  const offeredTools: string[][] = [];
  let index = 0;

  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: {
      async nextStep(input) {
        offeredTools.push(input.tools.map(({ name }) => name));
        return steps[index++];
      },
    },
    tools: new Map([
      ["get_coverage_state", tool("get_coverage_state")],
      ["get_interview_history", tool("get_interview_history")],
      ["get_resume_evidence", tool("get_resume_evidence")],
      ["ask_interview_question", ask],
      ["finish_interview", tool("finish_interview")],
    ]),
    initialMessages: [{ role: "user", content: "回答" }],
    signal: new AbortController().signal,
    progressHash: () => String(index),
  });

  assert.equal(result.exitReason, "completed");
  assert.deepEqual(offeredTools[16].sort(), ["ask_interview_question", "finish_interview"]);
  assert.equal(offeredTools[16].includes("get_resume_evidence"), false);
});

test("does not count an early terminal action as a planning step", async () => {
  const { result, modelCalls } = await fixture([
    { type: "tool_call", callId: "ask", toolName: "ask_interview_question", args: {} },
  ]);
  assert.equal(result.exitReason, "completed");
  assert.equal(result.turnCount, 0);
  assert.equal(modelCalls, 1);
});

test("restores planning tools after an early terminal action needs evidence repair", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "terminal-repair" });
  const executedTools: string[] = [];
  const handlers: Parameters<typeof createInterviewToolRegistry>[0]["handlers"] = {
    async get_resume_evidence(input) {
      executedTools.push("get_resume_evidence");
      return { requested: input };
    },
    async ask_interview_question(input) {
      executedTools.push("ask_interview_question");
      return { accepted: true, input };
    },
    async get_interview_history() { throw new Error("unexpected get_interview_history"); },
    async get_coverage_state() { throw new Error("unexpected get_coverage_state"); },
    async update_coverage() { throw new Error("unexpected update_coverage"); },
    async finish_interview() { throw new Error("unexpected finish_interview"); },
  };
  const registry = createInterviewToolRegistry({
    handlers,
    async loadActionInput(input) {
      return {
        candidateRoundCount: 1,
        categoryCounts: {},
        recentQuestions: [],
        requestedUserEnd: false,
        proposal: {
          action: input.action,
          category: input.category,
          intent: input.intent,
          question: input.question,
          resumeEvidenceIds: input.resumeEvidenceIds,
        },
      };
    },
  });
  const questionInput = {
    action: "ask" as const,
    category: "technical_depth" as const,
    intent: "follow_up" as const,
    acknowledgement: "你介绍了智能审批项目。",
    question: "请说明审批链路的数据一致性如何保证？",
    claims: [],
    topic: "审批一致性",
  };
  const steps: AgentModelStep[] = [
    { type: "tool_call", callId: "ask-missing", toolName: "ask_interview_question", args: { ...questionInput, resumeEvidenceIds: [] } },
    { type: "tool_call", callId: "load-evidence", toolName: "get_resume_evidence", args: { evidenceIds: ["project:3"] } },
    { type: "tool_call", callId: "ask-grounded", toolName: "ask_interview_question", args: { ...questionInput, resumeEvidenceIds: ["project:3"] } },
  ];
  const offeredTools: string[][] = [];
  let index = 0;

  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: {
      async nextStep(input) {
        offeredTools.push(input.tools.map(({ name }) => name));
        return steps[index++];
      },
    },
    tools: registry,
    initialMessages: [{ role: "user", content: "回答" }],
    signal: new AbortController().signal,
    progressHash: () => String(index),
  });

  assert.equal(result.exitReason, "completed");
  assert.equal(result.turnCount, 1);
  assert.ok(offeredTools[1].includes("get_resume_evidence"));
  assert.deepEqual(executedTools, ["get_resume_evidence", "ask_interview_question"]);
  const firstAskCompletion = (await repository.listEvents(run.id, 0)).find((event) => {
    const payload = event.payload as { toolName?: string };
    return event.type === "tool_call_completed" && payload.toolName === "ask_interview_question";
  });
  assert.equal((firstAskCompletion?.payload as {
    result?: { error?: { code?: string } };
  }).result?.error?.code, "MISSING_EVIDENCE");
  assert.equal(repository.inspectRun(run.id)?.checkpoint?.terminalAttemptCount, 2);
});

test("allows one terminal action and two repairs", async () => {
  const terminal = tool("ask_interview_question");
  terminal.validateBusiness = async () => ({
    code: "SOURCE_NOT_FOUND",
    message: "missing",
    retryable: true,
  });
  const { result, repository, run, modelCalls } = await fixture(Array.from({ length: 4 }, (_, index) => ({
    type: "tool_call" as const,
    callId: `terminal-${index}`,
    toolName: "ask_interview_question",
    args: {},
  })), [terminal]);
  assert.equal(result.exitReason, "terminal_action_failed");
  assert.equal(result.turnCount, 0);
  assert.equal(modelCalls, 3);
  assert.equal(repository.inspectRun(run.id)?.checkpoint?.terminalAttemptCount, 3);
});

test("moves repeated invalid model output to terminal failure without consuming planning", async () => {
  const steps = Array.from({ length: 6 }, (_, index) => ({
    type: "final" as const,
    content: `invalid-${index}`,
  }));
  const { result, modelCalls } = await fixture(steps);
  assert.equal(result.exitReason, "terminal_action_failed");
  assert.equal(result.turnCount, 0);
  assert.equal(modelCalls, 6);
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

test("keeps provider attempts local to each logical model call", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "attempt-local" });
  let attempts = 0;
  let logicalCalls = 0;
  const result = await runInterviewAgent({
    interviewId: "interview",
    runId: run.id,
    repository,
    model: {
      async nextStep() { throw new Error("unused"); },
      async nextStepStream(input) {
        logicalCalls += 1;
        const attemptsForCall = logicalCalls === 5 ? 1 : 3;
        for (let index = 0; index < attemptsForCall; index += 1) {
          attempts += 1;
          await input.onAttemptStarted?.({
            model: "fast",
            attemptId: `attempt-${attempts}`,
            attemptNumber: attempts,
            provisionalMessageId: `message-${index}`,
          });
        }
        return {
          step: logicalCalls === 5
            ? { type: "tool_call" as const, callId: "ask", toolName: "ask_interview_question", args: {} }
            : { type: "tool_call" as const, callId: `plan-${logicalCalls}`, toolName: "get_coverage_state", args: { logicalCalls } },
          attemptId: "selected",
          provisionalMessageId: null,
        };
      },
    },
    tools: new Map([
      ["get_coverage_state", tool("get_coverage_state")],
      ["ask_interview_question", tool("ask_interview_question")],
    ]),
    initialMessages: [],
    signal: new AbortController().signal,
    progressHash: () => String(logicalCalls),
  });
  assert.equal(result.exitReason, "completed");
  assert.equal(result.turnCount, 4);
  assert.equal(attempts, 13);
});

test("maps provider exceptions separately from aborted streaming", async () => {
  const providerRepository = createInMemoryInterviewAgentRepository();
  const providerRun = await providerRepository.createRun({ interviewId: "interview", idempotencyKey: "provider" });
  const providerResult = await runInterviewAgent({
    interviewId: "interview",
    runId: providerRun.id,
    repository: providerRepository,
    model: { async nextStep() { throw new Error("provider unavailable"); } },
    tools: new Map([["ask_interview_question", tool("ask_interview_question")]]),
    initialMessages: [],
    signal: new AbortController().signal,
    progressHash: () => "same",
  });
  assert.equal(providerResult.exitReason, "provider_failed");

  const controller = new AbortController();
  const abortedRepository = createInMemoryInterviewAgentRepository();
  const abortedRun = await abortedRepository.createRun({ interviewId: "interview", idempotencyKey: "aborted-provider" });
  const abortedResult = await runInterviewAgent({
    interviewId: "interview",
    runId: abortedRun.id,
    repository: abortedRepository,
    model: { async nextStep() { controller.abort(); throw new Error("aborted"); } },
    tools: new Map([["ask_interview_question", tool("ask_interview_question")]]),
    initialMessages: [],
    signal: controller.signal,
    progressHash: () => "same",
  });
  assert.equal(abortedResult.exitReason, "aborted_streaming");
});

test("recovers the observed history coverage and evidence planning sequence", async () => {
  const steps: AgentModelStep[] = [
    { type: "tool_call", callId: "history", toolName: "get_interview_history", args: { limit: 10 } },
    { type: "tool_call", callId: "coverage", toolName: "get_coverage_state", args: {} },
    { type: "tool_call", callId: "partial", toolName: "update_coverage", args: { status: "partial" } },
    { type: "tool_call", callId: "bad-evidence", toolName: "get_resume_evidence", args: { evidenceIds: ["intro_01"] } },
    { type: "tool_call", callId: "raw-evidence", toolName: "get_resume_evidence", args: { evidenceIds: ["resume:raw"] } },
    { type: "tool_call", callId: "sufficient", toolName: "update_coverage", args: { status: "sufficient" } },
    { type: "tool_call", callId: "ask", toolName: "ask_interview_question", args: {} },
  ];
  const tools = [
    tool("get_interview_history"),
    tool("get_coverage_state"),
    tool("update_coverage"),
    tool("get_resume_evidence"),
    tool("ask_interview_question"),
  ];
  const { result, modelCalls } = await fixture(steps, tools, { progressHash: String });
  assert.equal(result.exitReason, "completed");
  assert.equal(result.turnCount, 6);
  assert.equal(modelCalls, 7);
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
