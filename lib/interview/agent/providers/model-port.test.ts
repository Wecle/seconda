import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyInterviewAgentModelError,
  createProviderToolSet,
  createStructuredInterviewAgentModelPort,
  createStreamingInterviewAgentModelPort,
  type AgentToolDescriptor,
  type AgentModelStreamEvent,
} from "@/lib/interview/agent/providers/model-port";
import { AGENT_SYSTEM_PROMPT } from "@/lib/interview/agent/prompts/system";
import { RESPONSE_TEXT_SCHEMA_DESCRIPTION } from "@/lib/interview/agent/domain/turn-proposal";
import { providerInterviewToolInputSchema } from "@/lib/interview/agent/tools/registry";
import {
  AIResourceBudgetError,
  type AIAttemptHandle,
  type AITaskHandle,
  type AITelemetryLifecycle,
} from "@/lib/ai/telemetry/lifecycle";

const openingSubmitSchema = providerInterviewToolInputSchema(
  "submit_interview_turn",
  "opening",
);
const submitTool = [{
  name: "submit_interview_turn",
  description: "submit",
  inputSchema: openingSubmitSchema,
}];
const openingProposal = {
  publicAnalysis: "候选人的方向清晰，下一步邀请其介绍最近经历与岗位期待。",
  assessment: null,
  coverageChanges: [],
  roleResolution: {
    status: "inferred" as const,
    value: "后端工程师",
    confidence: "high" as const,
    resumeEvidenceIds: ["resume:raw"],
  },
  decision: {
    action: "ask" as const,
    category: "introduction" as const,
    intent: "new_topic" as const,
    evidenceIds: ["resume:raw"],
    coverageTarget: "目标岗位与自我介绍",
    estimatedInformationGain: "high" as const,
  },
  responseText: "请介绍一下自己。",
};

const telemetryTask: AITaskHandle = {
  id: "telemetry-task",
  task: "interview.agent",
  context: { operationKey: "interview.agent:run" },
  budgetMode: "observe",
  tokenLimit: 500_000,
  noOp: false,
};

function telemetryFixture(overrides: Partial<AITelemetryLifecycle> = {}) {
  const calls: Array<{ name: string; input?: unknown }> = [];
  const lifecycle: AITelemetryLifecycle = {
    async startTask() { return telemetryTask; },
    async beforeAttempt(input) {
      calls.push({ name: "before", input });
      return {
        id: `telemetry-attempt-${input.attemptNumber}`,
        taskRunId: telemetryTask.id,
        attemptNumber: input.attemptNumber,
        provider: "deepseek",
        model: input.model,
        credentialTier: input.credentialTier,
        startedAtMs: 0,
        price: null,
        noOp: false,
      } satisfies AIAttemptHandle;
    },
    async completeAttempt(input) { calls.push({ name: "complete", input }); },
    async failAttempt(input) { calls.push({ name: "fail", input }); },
    async completeTask() {},
    async failTask() {},
    ...overrides,
  };
  return { lifecycle, calls };
}

test("system prompt requests public progress without hidden reasoning", () => {
  for (const language of ["zh", "en", "es", "de"]) {
    assert.equal(AGENT_SYSTEM_PROMPT.includes(language), true);
  }
  for (const persona of ["friendly", "standard", "stressful"]) {
    assert.equal(AGENT_SYSTEM_PROMPT.includes(persona), true);
  }
  assert.match(AGENT_SYSTEM_PROMPT, /公开.*进度/);
  assert.match(AGENT_SYSTEM_PROMPT, /隐藏.*推理/);
  assert.match(AGENT_SYSTEM_PROMPT, /每次工具调用.*publicAnalysis/);
  assert.match(AGENT_SYSTEM_PROMPT, /只读工具.*一句/);
  assert.match(AGENT_SYSTEM_PROMPT, /submit_interview_turn.*2–4 句/);
  assert.match(AGENT_SYSTEM_PROMPT, /publicAnalysis.*先于其他工具字段/);
  assert.match(AGENT_SYSTEM_PROMPT, /responseText.*最后/);
  assert.match(AGENT_SYSTEM_PROMPT, /followUpNeeded=true.*partial/);
  assert.match(AGENT_SYSTEM_PROMPT, /followUpNeeded=false.*sufficient/);
  assert.match(AGENT_SYSTEM_PROMPT, /第 3 题.*exhausted/);
  assert.match(AGENT_SYSTEM_PROMPT, /通常只为当前回答分类提交 coverageChanges/);
  assert.match(
    AGENT_SYSTEM_PROMPT,
    /role_resolution.*inferred.*introduction\/new_topic ask/,
  );
  assert.match(
    AGENT_SYSTEM_PROMPT,
    /role_resolution.*needs_clarification.*target_role clarify/,
  );
  assert.match(AGENT_SYSTEM_PROMPT, /awaiting_role_clarification.*confirmed/);
  assert.match(AGENT_SYSTEM_PROMPT, /formal_interview.*roleResolution 必须为 null/);
  assert.match(AGENT_SYSTEM_PROMPT, /不得枚举或复述简历/);
  assert.match(AGENT_SYSTEM_PROMPT, /ask 或 clarify.*唯一核心意图/);
  assert.equal(
    AGENT_SYSTEM_PROMPT.includes(["只能包含一个", "疑问句"].join("")),
    false,
  );
  assert.equal(
    AGENT_SYSTEM_PROMPT.includes(
      [["只能", "出现", "一个"].join(""), ["?", " 或 ", "？"].join("")].join(""),
    ),
    false,
  );
  assert.match(AGENT_SYSTEM_PROMPT, /finish.*不得邀请候选人继续作答/);
});

test("builds real AI SDK tools without execute handlers", () => {
  const tools = createProviderToolSet(submitTool);
  assert.deepEqual(Object.keys(tools), ["submit_interview_turn"]);
  assert.equal("inputSchema" in tools.submit_interview_turn, true);
  assert.equal("execute" in tools.submit_interview_turn, false);
  assert.equal(tools.submit_interview_turn.inputSchema, openingSubmitSchema);
  const inputSchema = tools.submit_interview_turn.inputSchema as {
    safeParse(input: unknown): { success: boolean };
  };
  assert.equal(inputSchema.safeParse(openingProposal).success, true);
  const businessOnlyProposal = Object.fromEntries(
    Object.entries(openingProposal).filter(([key]) => key !== "publicAnalysis"),
  );
  assert.equal(inputSchema.safeParse(businessOnlyProposal).success, false);
});

test("rejects a formal terminal call with a non-null role resolution", async () => {
  const formalSchema = providerInterviewToolInputSchema("submit_interview_turn", "answer");
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: (async function* () {
        yield {
          type: "tool-call",
          toolCallId: "call-formal-role",
          toolName: "submit_interview_turn",
          input: openingProposal,
        } as const;
      })(),
    }),
  });

  await assert.rejects(port.nextStepStream!({
    runId: "run-formal-role",
    messages: [],
    tools: [{
      name: "submit_interview_turn",
      description: "submit",
      inputSchema: formalSchema,
    }],
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "MODEL_TOOL_ACTION_INVALID");
    return true;
  });
});

test("production DeepSeek Agent wiring sends a conversational required-tool request", async () => {
  const names = [
    "AI_MODEL_FAST",
    "AI_MODEL_FAST_FALLBACK",
    "AI_MODEL_QUALITY",
    "AI_MODEL_QUALITY_FALLBACK",
    "AI_APPROVED_MODELS",
    "FAST_MODEL_API_KEY",
    "QUALITY_MODEL_API_KEY",
  ] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  let body: Record<string, unknown> = {};

  Object.assign(process.env, {
    AI_MODEL_FAST: "deepseek/deepseek-chat",
    AI_MODEL_QUALITY: "openai/gpt-5-mini",
    AI_APPROVED_MODELS: "deepseek/deepseek-chat,openai/gpt-5-mini",
    FAST_MODEL_API_KEY: "fast-sentinel",
    QUALITY_MODEL_API_KEY: "quality-sentinel",
  });
  delete process.env.AI_MODEL_FAST_FALLBACK;
  delete process.env.AI_MODEL_QUALITY_FALLBACK;

  try {
    const port = createStructuredInterviewAgentModelPort({
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        const toolArguments = JSON.stringify(openingProposal);
        const toolChunk = JSON.stringify({
          id: "fixture",
          created: 0,
          model: "deepseek-chat",
          choices: [{
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [{
                index: 0,
                id: "call-provider-boundary",
                function: {
                  name: "submit_interview_turn",
                  arguments: toolArguments,
                },
              }],
            },
            finish_reason: null,
          }],
        });
        const finishChunk = JSON.stringify({
          id: "fixture",
          created: 0,
          model: "deepseek-chat",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
        return new Response(
          `data: ${toolChunk}\n\ndata: ${finishChunk}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    const result = await port.nextStepStream!({
      runId: "run-provider-boundary",
      messages: [],
      tools: submitTool,
      signal: new AbortController().signal,
      onProviderProgress: async () => {},
      onStreamEvent: async () => false,
    });
    assert.equal(result.step.type, "tool_call");
  } finally {
    for (const name of names) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.equal("response_format" in body, false);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.parallel_tool_calls, false);
  assert.equal(Array.isArray(body.tools), true);
  assert.equal((body.tools as unknown[]).length, 1);
  assert.equal(body.tool_choice, "required");
  assert.equal(
    JSON.stringify(body.tools).includes(RESPONSE_TEXT_SCHEMA_DESCRIPTION),
    true,
  );
  assert.match(
    JSON.stringify(body.tools),
    /role_resolution.*needs_clarification.*target_role clarify/,
  );
});

test("streams public text and growing partial terminal input across chunk boundaries", async () => {
  const serialized = JSON.stringify(openingProposal);
  const splitAt = serialized.indexOf('"responseText"');
  const firstJsonChunk = serialized.slice(0, splitAt);
  const secondJsonChunk = serialized.slice(splitAt);
  const events: AgentModelStreamEvent[] = [];
  const progress: string[] = [];
  let durablePublicEventCount = 0;
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    createAttemptId: () => "attempt-1",
    createMessageId: () => "message-1",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "先核对证据。" } as const;
        yield {
          type: "tool-input-start",
          id: "call-1",
          toolName: "submit_interview_turn",
        } as const;
        yield { type: "tool-input-delta", id: "call-1", delta: firstJsonChunk } as const;
        yield { type: "tool-input-delta", id: "call-1", delta: secondJsonChunk } as const;
        yield {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "submit_interview_turn",
          input: openingProposal,
        } as const;
      })(),
    }),
  });

  const result = await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => { progress.push("progress"); },
    onStreamEvent: async (event) => {
      events.push(event);
      if (event.type !== "public_reasoning_delta") return false;
      durablePublicEventCount += 1;
      return true;
    },
  });

  assert.deepEqual(events[0], {
    type: "public_reasoning_delta",
    attemptId: "attempt-1",
    text: "先核对证据。",
  });
  const inputEvents = events.filter((event) => event.type === "tool_input_delta");
  assert.equal(inputEvents.length, 2);
  assert.equal(inputEvents[0].inputText, firstJsonChunk);
  assert.equal(inputEvents[1].inputText, serialized);
  assert.notEqual(inputEvents[0].partialInput, undefined);
  assert.deepEqual(inputEvents[1].partialInput, openingProposal);
  assert.equal(
    events.some((event) => event.type === "tool_input_delta"
      && typeof event.partialInput === "object"
      && event.partialInput !== null
      && "publicAnalysis" in event.partialInput),
    true,
  );
  assert.deepEqual(result.step, {
    type: "tool_call",
    callId: "call-1",
    toolName: "submit_interview_turn",
    args: openingProposal,
  });
  assert.equal(result.attemptId, "attempt-1");
  assert.equal(result.provisionalMessageId, "message-1");
  assert.equal(progress.length, 5);
  assert.equal(durablePublicEventCount, 1);
});

test("ignores provider hidden reasoning deltas", async () => {
  const events: AgentModelStreamEvent[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    createAttemptId: () => "attempt-hidden",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: (async function* () {
        yield { type: "reasoning-delta", id: "reasoning", text: "供应商隐藏思维链" } as const;
        yield { type: "text-delta", text: "正在检查覆盖度。" } as const;
        yield {
          type: "tool-call",
          toolCallId: "call-hidden",
          toolName: "submit_interview_turn",
          input: openingProposal,
        } as const;
      })(),
    }),
  });

  await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async (event) => { events.push(event); return false; },
  });

  assert.deepEqual(events, [{
    type: "public_reasoning_delta",
    attemptId: "attempt-hidden",
    text: "正在检查覆盖度。",
  }]);
});

test("parses terminal input across single-character JSON chunks", async () => {
  const proposal = { ...openingProposal, responseText: "请介绍一下自己🙂。" };
  const serialized = JSON.stringify(proposal);
  const inputEvents: AgentModelStreamEvent[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: (async function* () {
        yield {
          type: "tool-input-start",
          id: "call-chunks",
          toolName: "submit_interview_turn",
        } as const;
        for (const delta of serialized.split("")) {
          yield { type: "tool-input-delta", id: "call-chunks", delta } as const;
        }
        yield {
          type: "tool-call",
          toolCallId: "call-chunks",
          toolName: "submit_interview_turn",
          input: proposal,
        } as const;
      })(),
    }),
  });

  await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async (event) => { inputEvents.push(event); return false; },
  });

  const last = inputEvents.at(-1);
  assert.equal(last?.type, "tool_input_delta");
  assert.equal(last?.type === "tool_input_delta" && last.inputText, serialized);
  assert.deepEqual(last?.type === "tool_input_delta" && last.partialInput, proposal);
});

test("rejects a stream that never produces a tool call", async () => {
  let durablePublicEventCount = 0;
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "只有公开进度" } as const;
      })(),
    }),
  });

  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => {
      durablePublicEventCount += 1;
      return true;
    },
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROVISIONAL_STREAM_ABORTED");
    return true;
  });
  assert.equal(durablePublicEventCount, 1);
});

test("continues provider attempt numbers across logical model calls", async () => {
  const started: number[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    createAttemptId: (_model, number) => `attempt-${number}`,
    onAttemptStarted: async ({ attemptNumber }) => { started.push(attemptNumber); },
    streamCandidate: async () => ({
      fullStream: (async function* () {
        yield {
          type: "tool-call",
          toolCallId: "call",
          toolName: "submit_interview_turn",
          input: openingProposal,
        } as const;
      })(),
    }),
  });
  const input = {
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  };

  await port.nextStepStream!({ ...input, attemptNumberOffset: 4 });
  await port.nextStepStream!({ ...input, attemptNumberOffset: 5 });

  assert.deepEqual(started, [5, 6]);
});

test("aborts an idle provider stream before public content", async () => {
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    idleTimeoutMs: 5,
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: (async function* () {
        await new Promise(() => {});
      })(),
    }),
  });
  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROVIDER_IDLE_TIMEOUT");
    return true;
  });
});

test("retries and falls back when failure occurs before a public event", async () => {
  const calls: string[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: () => "transient",
    sleep: async () => {},
    onAttemptStarted: async () => {},
    streamCandidate: async ({ model }) => {
      calls.push(model);
      if (model === "quality") {
        return {
          fullStream: (async function* () {
            yield {
              type: "tool-call",
              toolCallId: "quality-call",
              toolName: "submit_interview_turn",
              input: openingProposal,
            } as const;
          })(),
        };
      }
      return {
        fullStream: (async function* () {
          throw new Error("broken before public content");
        })(),
      };
    },
  });

  const result = await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  });

  assert.equal(result.step.type, "tool_call");
  assert.deepEqual(calls, ["fast", "fast", "fast", "quality"]);
});

test("does not retry after the first public event is durably accepted", async () => {
  const calls: string[] = [];
  const persistedPublicEvents: AgentModelStreamEvent[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: () => "transient",
    sleep: async () => {},
    onAttemptStarted: async () => {},
    streamCandidate: async ({ model }) => {
      calls.push(model);
      return {
        fullStream: (async function* () {
          yield { type: "text-delta", text: "已持久化公开进度" } as const;
          throw new Error("stream broke");
        })(),
      };
    },
  });

  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async (event) => {
      persistedPublicEvents.push(event);
      return true;
    },
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROVISIONAL_STREAM_ABORTED");
    return true;
  });

  assert.equal(persistedPublicEvents.length, 1);
  assert.deepEqual(calls, ["fast"]);
});

test("accepts a complete final tool call without streamed input", async () => {
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: parts({
        type: "tool-call",
        toolCallId: "call-direct",
        toolName: "submit_interview_turn",
        input: openingProposal,
      }),
    }),
  });

  const result = await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  });

  assert.equal(result.step.type, "tool_call");
  assert.equal(result.step.type === "tool_call" && result.step.callId, "call-direct");
});

test("rejects conflicting tool stream protocols instead of taking the last call", async () => {
  const activeTools = [
    ...submitTool,
    {
      name: "get_coverage_state",
      description: "coverage",
      inputSchema: providerInterviewToolInputSchema("get_coverage_state", "opening"),
    },
  ];
  const cases: Array<{
    name: string;
    streamParts: unknown[];
    tools?: typeof activeTools;
    expectedProtocol?: unknown;
  }> = [
    {
      name: "duplicate start",
      streamParts: [
        { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" },
        { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" },
      ],
      expectedProtocol: {
        kind: "malformed_stream",
        reason: "duplicate_tool_input_start",
        eventType: "tool-input-start",
        stage: "tool_input_streaming",
      },
    },
    {
      name: "multiple starts",
      streamParts: [
        { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" },
        { type: "tool-input-start", id: "call-2", toolName: "submit_interview_turn" },
      ],
      expectedProtocol: {
        kind: "malformed_stream",
        reason: "parallel_tool_input_start",
        eventType: "tool-input-start",
        stage: "tool_input_streaming",
      },
    },
    {
      name: "public text after tool input start",
      streamParts: [
        { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" },
        { type: "text-delta", text: "这段文本不能在回复参数生成期间混入公开推理。" },
      ],
    },
    {
      name: "interleaved ids",
      streamParts: [
        { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" },
        { type: "tool-input-delta", id: "call-2", delta: "{}" },
      ],
    },
    {
      name: "final id mismatch",
      streamParts: [
        { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" },
        {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "submit_interview_turn",
          input: openingProposal,
        },
      ],
    },
    {
      name: "final name mismatch",
      tools: activeTools,
      streamParts: [
        { type: "tool-input-start", id: "call-1", toolName: "submit_interview_turn" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "get_coverage_state",
          input: { publicAnalysis: "先检查当前能力覆盖情况。" },
        },
      ],
    },
    {
      name: "multiple final calls",
      streamParts: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "submit_interview_turn",
          input: openingProposal,
        },
        {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "submit_interview_turn",
          input: openingProposal,
        },
      ],
    },
  ];

  for (const fixture of cases) {
    await assertProtocolRejected(
      fixture.name,
      fixture.streamParts,
      fixture.tools ?? activeTools,
      [],
      fixture.expectedProtocol,
    );
  }
});

test("rejects an unknown tool input start before publishing its input", async () => {
  const events: AgentModelStreamEvent[] = [];
  await assertProtocolRejected("unknown start", [
    { type: "tool-input-start", id: "call-1", toolName: "finish_interview" },
    { type: "tool-input-delta", id: "call-1", delta: "{}" },
  ], submitTool, events, {
    kind: "inactive_tool",
    toolName: "finish_interview",
    reason: "inactive_tool_input_start",
    eventType: "tool-input-start",
    stage: "before_tool_input",
  });
  assert.deepEqual(events, []);
});

test("classifies malformed active-tool arguments as a model action error", async () => {
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: parts({
        type: "tool-call",
        toolCallId: "call-malformed",
        toolName: "get_coverage_state",
        input: {
          publicAnalysis: "先检查当前能力覆盖情况。",
          unexpected: true,
        },
      }),
    }),
  });

  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: [{
      name: "get_coverage_state",
      description: "coverage",
      inputSchema: providerInterviewToolInputSchema("get_coverage_state", "opening"),
    }],
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "MODEL_TOOL_ACTION_INVALID");
    assert.deepEqual((error as { modelAction?: unknown }).modelAction, {
      kind: "malformed_tool_arguments",
      toolName: "get_coverage_state",
    });
    return true;
  });
});

test("a false durable ack preserves pre-public retry", async () => {
  const calls: string[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "transient",
    sleep: async () => {},
    onAttemptStarted: async () => {},
    streamCandidate: async ({ model }) => {
      calls.push(model);
      if (calls.length === 1) {
        return {
          fullStream: (async function* () {
            yield {
              type: "tool-input-start",
              id: "call-unpublished",
              toolName: "submit_interview_turn",
            } as const;
            yield { type: "tool-input-delta", id: "call-unpublished", delta: "{" } as const;
            throw new Error("retry me");
          })(),
        };
      }
      return {
        fullStream: parts({
          type: "tool-call",
          toolCallId: "call-retry",
          toolName: "submit_interview_turn",
          input: openingProposal,
        }),
      };
    },
  });

  await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  });

  assert.deepEqual(calls, ["fast", "fast"]);
});

test("a rejected stream callback is not treated as durable acceptance", async () => {
  const calls: string[] = [];
  let callbackCalls = 0;
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "transient",
    sleep: async () => {},
    onAttemptStarted: async () => {},
    streamCandidate: async ({ model }) => {
      calls.push(model);
      return {
        fullStream: calls.length === 1
          ? parts({ type: "text-delta", text: "写入失败" })
          : parts({
            type: "tool-call",
            toolCallId: "call-after-retry",
            toolName: "submit_interview_turn",
            input: openingProposal,
          }),
      };
    },
  });

  await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => {
      callbackCalls += 1;
      throw new Error("durable append failed");
    },
  });

  assert.equal(callbackCalls, 1);
  assert.deepEqual(calls, ["fast", "fast"]);
});

test("idle timeout aborts each provider attempt and falls back", async () => {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  let iteratorReturns = 0;
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: classifyInterviewAgentModelError,
    idleTimeoutMs: 5,
    sleep: async () => {},
    onAttemptStarted: async () => {},
    streamCandidate: async ({ model, signal }) => {
      calls.push(model);
      signals.push(signal);
      return model === "quality"
        ? {
          fullStream: parts({
            type: "tool-call",
            toolCallId: "quality-call",
            toolName: "submit_interview_turn",
            input: openingProposal,
          }),
        }
        : { fullStream: stalledParts(() => { iteratorReturns += 1; }) };
    },
  });

  await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  });

  assert.deepEqual(calls, ["fast", "fast", "fast", "quality"]);
  assert.equal(signals.slice(0, 3).every((signal) => signal.aborted), true);
  assert.equal(signals[3].aborted, false);
  assert.equal(iteratorReturns, 3);
});

test("caller abort immediately cancels a pending provider read", async () => {
  const caller = new AbortController();
  let providerSignal: AbortSignal | undefined;
  let iteratorReturns = 0;
  let markReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: () => "transient",
    idleTimeoutMs: 60_000,
    sleep: async () => {},
    onAttemptStarted: async () => {},
    streamCandidate: async ({ signal }) => {
      providerSignal = signal;
      return {
        fullStream: stalledParts(
          () => { iteratorReturns += 1; },
          markReadStarted,
        ),
      };
    },
  });
  const running = port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: caller.signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  });
  await readStarted;
  caller.abort(new DOMException("cancelled", "AbortError"));

  await assert.rejects(running, (error: unknown) => {
    assert.equal((error as { name?: string }).name, "AbortError");
    return true;
  });
  assert.equal(providerSignal?.aborted, true);
  assert.equal(iteratorReturns, 1);
});

test("turns an AI SDK abort part into a provider stream failure", async () => {
  let providerSignal: AbortSignal | undefined;
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async ({ signal }) => {
      providerSignal = signal;
      return { fullStream: parts({ type: "abort", reason: "upstream stopped" }) };
    },
  });

  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROVIDER_STREAM_ABORTED");
    return true;
  });
  assert.equal(providerSignal?.aborted, true);
});

test("records first provider output timing and resolves successful Usage once", async () => {
  const telemetry = telemetryFixture();
  const usage = Promise.resolve({
    inputTokens: 12,
    outputTokens: 3,
    inputTokenDetails: { cacheReadTokens: 4 },
  });
  let usageReads = 0;
  const usageOnce = { then: usage.then.bind(usage) };
  Object.defineProperty(usageOnce, "then", {
    get() {
      usageReads += 1;
      return usage.then.bind(usage);
    },
  });
  const times = [100, 125, 170];
  const observedUsage: unknown[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "deepseek/fast", credentialTier: "fast" }],
    classifyError: () => "fatal",
    now: () => times.shift() ?? 170,
    telemetry: { lifecycle: telemetry.lifecycle, task: telemetryTask },
    onAttemptStarted: async () => {},
    onUsage: async ({ usage: value }) => { observedUsage.push(value); },
    streamCandidate: async () => ({
      usage: usageOnce,
      fullStream: parts(
        { type: "text-delta", text: "" },
        {
          type: "tool-call",
          toolCallId: "call",
          toolName: "submit_interview_turn",
          input: openingProposal,
        },
      ),
    }),
  });

  await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  });

  assert.equal(usageReads, 1);
  assert.deepEqual(observedUsage, [{
    inputTokens: 12,
    outputTokens: 3,
    cachedInputTokens: 4,
    cacheWriteTokens: null,
  }]);
  const completed = telemetry.calls.find((call) => call.name === "complete")?.input as {
    usage: unknown;
    firstTokenMs: number;
    durationMs: number;
  };
  assert.deepEqual(completed.usage, observedUsage[0]);
  assert.equal(completed.firstTokenMs, 25);
  assert.equal(completed.durationMs, 70);
});

test("records failed Usage and keeps retry attempt numbers monotonic", async () => {
  const telemetry = telemetryFixture();
  const attempts: number[] = [];
  let providerCalls = 0;
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "deepseek/fast", credentialTier: "fast" }],
    classifyError: () => "transient",
    sleep: async () => {},
    telemetry: { lifecycle: telemetry.lifecycle, task: telemetryTask },
    onAttemptStarted: async ({ attemptNumber }) => { attempts.push(attemptNumber); },
    streamCandidate: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return {
          usage: Promise.resolve({ inputTokens: 7, outputTokens: 1 }),
          fullStream: (async function* () { throw new Error("temporary"); })(),
        };
      }
      return {
        usage: Promise.resolve({ inputTokens: 8, outputTokens: 2 }),
        fullStream: parts({
          type: "tool-call",
          toolCallId: "call",
          toolName: "submit_interview_turn",
          input: openingProposal,
        }),
      };
    },
  });

  await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    attemptNumberOffset: 4,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  });

  assert.deepEqual(attempts, [5, 6]);
  assert.deepEqual(
    telemetry.calls.filter((call) => call.name === "before")
      .map((call) => (call.input as { attemptNumber: number }).attemptNumber),
    [5, 6],
  );
  assert.deepEqual(
    (telemetry.calls.find((call) => call.name === "fail")?.input as { usage: unknown }).usage,
    { inputTokens: 7, outputTokens: 1, cachedInputTokens: null, cacheWriteTokens: null },
  );
});

test("rejects an exhausted budget before invoking the provider", async () => {
  const telemetry = telemetryFixture({
    async beforeAttempt() {
      throw new AIResourceBudgetError("AI_RESOURCE_BUDGET_EXCEEDED");
    },
  });
  let providerCalls = 0;
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "deepseek/fast", credentialTier: "fast" }],
    classifyError: () => "transient",
    telemetry: { lifecycle: telemetry.lifecycle, task: telemetryTask },
    onAttemptStarted: async () => {},
    streamCandidate: async () => {
      providerCalls += 1;
      return { fullStream: parts() };
    },
  });

  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => false,
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "AI_RESOURCE_BUDGET_EXCEEDED");
    return true;
  });
  assert.equal(providerCalls, 0);
});

test("marks a provisionally accepted stream abort as a failed telemetry attempt", async () => {
  const telemetry = telemetryFixture();
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "deepseek/fast", credentialTier: "fast" }],
    classifyError: () => "transient",
    telemetry: { lifecycle: telemetry.lifecycle, task: telemetryTask },
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "durable" };
        throw new Error("stream closed");
      })(),
    }),
  });

  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: submitTool,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async () => true,
  }), /provisional content was accepted/);
  assert.equal(telemetry.calls.filter((call) => call.name === "fail").length, 1);
});

async function assertProtocolRejected(
  name: string,
  streamParts: unknown[],
  tools: readonly AgentToolDescriptor[],
  events: AgentModelStreamEvent[] = [],
  expectedProtocol?: unknown,
) {
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({ fullStream: parts(...streamParts) }),
  });
  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools,
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onStreamEvent: async (event) => { events.push(event); return false; },
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "MODEL_STREAM_PROTOCOL_ERROR", name);
    if (expectedProtocol) {
      assert.deepEqual((error as { protocol?: unknown }).protocol, expectedProtocol);
    }
    return true;
  });
}

function parts(...values: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    yield* values;
  })();
}

function stalledParts(onReturn: () => void, onNext?: () => void): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          onNext?.();
          return new Promise<IteratorResult<unknown>>(() => {});
        },
        return: () => {
          onReturn();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}
