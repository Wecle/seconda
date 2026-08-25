import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { ModelMessage } from "ai";
import {
  createInterviewToolRegistry,
  getTerminalLatch,
  hasSameStepRetrievalActivity,
  INTERVIEW_ACTION_COMMITTED,
  INTERVIEW_FATAL_ACTION_ERROR,
  RepairableInterviewRetrievalError,
  retrieveInterviewHistoryInputSchema,
  retrieveInterviewHistoryOutputSchema,
  retrieveResumeEvidenceInputSchema,
  retrieveResumeEvidenceOutputSchema,
} from "./agent/tools";
import { CURRENT_AGENT_STEP } from "@/lib/agent/capabilities/types";
import { interviewCapability } from "./agent/capability";
import { workspaceCapability } from "@/lib/agent/capabilities/workspace/capability";
import { projectModelInput } from "@/lib/agent/model-input";
import { prepareModelContext } from "@/lib/agent/context-lifecycle";
import { TOOL_RESULT_SPILL_CHARS } from "@/lib/agent/context-budget";
import type { AgentEvent, AgentEventType } from "@/lib/agent/types";

function mockEvent(sequence: number, type: AgentEventType, payload: Record<string, unknown>, runId = "run-1"): AgentEvent {
  return {
    id: sequence,
    sessionId: "session-1",
    runId,
    sequence,
    type,
    payload,
    dedupeKey: null,
    schemaVersion: 1,
    visibility: "model",
    createdAt: new Date(sequence),
  };
}

test("retrieve_resume_evidence schemas enforce strict input and output boundaries", () => {
  assert.deepEqual(
    retrieveResumeEvidenceInputSchema.parse({ query: "React", limit: 3 }),
    { query: "React", limit: 3 },
  );
  assert.deepEqual(
    retrieveResumeEvidenceInputSchema.parse({ evidenceIds: ["ev_0123456789abcdef"] }),
    { evidenceIds: ["ev_0123456789abcdef"], limit: 5 },
  );

  // Rejects when neither query nor evidenceIds is provided
  assert.throws(() => retrieveResumeEvidenceInputSchema.parse({ limit: 5 }), z.ZodError);
  // Rejects invalid evidenceId format
  assert.throws(() => retrieveResumeEvidenceInputSchema.parse({ evidenceIds: ["invalid-id"] }), z.ZodError);
  // Rejects extra fields
  assert.throws(() => retrieveResumeEvidenceInputSchema.parse({ query: "test", unknown: true }), z.ZodError);

  // Output schema
  const sampleOutput = {
    status: "success" as const,
    count: 1,
    evidence: [{ id: "ev_0123456789abcdef", path: "experience[0].bullets[0]", text: "Led migration to Next.js" }],
  };
  assert.deepEqual(retrieveResumeEvidenceOutputSchema.parse(sampleOutput), sampleOutput);
  assert.throws(() => retrieveResumeEvidenceOutputSchema.parse({ ...sampleOutput, status: "failed" }), z.ZodError);
  // Rejects when count does not match evidence array length
  assert.throws(() => retrieveResumeEvidenceOutputSchema.parse({ ...sampleOutput, count: 2 }), z.ZodError);
  // Rejects invalid evidence ID regex in output
  assert.throws(() => retrieveResumeEvidenceOutputSchema.parse({
    ...sampleOutput,
    evidence: [{ id: "not-ev-id", path: "p", text: "t" }],
  }), z.ZodError);
  // Rejects evidence array longer than 10
  assert.throws(() => retrieveResumeEvidenceOutputSchema.parse({
    status: "success",
    count: 11,
    evidence: Array(11).fill({ id: "ev_0123456789abcdef", path: "p", text: "t" }),
  }), z.ZodError);
});

test("retrieve_interview_history schemas enforce strict input and output boundaries", () => {
  assert.deepEqual(
    retrieveInterviewHistoryInputSchema.parse({ query: "architecture", topic: "System Design", limit: 5 }),
    { query: "architecture", topic: "System Design", limit: 5 },
  );
  assert.deepEqual(
    retrieveInterviewHistoryInputSchema.parse({}),
    { limit: 5 },
  );

  // Rejects extra fields
  assert.throws(() => retrieveInterviewHistoryInputSchema.parse({ unknownField: true }), z.ZodError);
  // Rejects negative or out of bounds limit
  assert.throws(() => retrieveInterviewHistoryInputSchema.parse({ limit: 0 }), z.ZodError);
  assert.throws(() => retrieveInterviewHistoryInputSchema.parse({ limit: 50 }), z.ZodError);

  // Output schema
  const sampleOutput = {
    status: "success" as const,
    count: 1,
    history: [{
      sequence: 1,
      kind: "main" as const,
      topic: "System Design",
      question: "How do you design a rate limiter?",
      answer: "Using token bucket algorithm.",
      skipped: false,
    }],
  };
  assert.deepEqual(retrieveInterviewHistoryOutputSchema.parse(sampleOutput), sampleOutput);
  assert.throws(() => retrieveInterviewHistoryOutputSchema.parse({ ...sampleOutput, history: [{ ...sampleOutput.history[0], kind: "other" }] }), z.ZodError);
  // Rejects when count does not match history array length
  assert.throws(() => retrieveInterviewHistoryOutputSchema.parse({ ...sampleOutput, count: 0 }), z.ZodError);
  // Rejects history array longer than 10
  assert.throws(() => retrieveInterviewHistoryOutputSchema.parse({
    status: "success",
    count: 11,
    history: Array(11).fill(sampleOutput.history[0]),
  }), z.ZodError);
});

test("workspace capability does not register interview retrieval tools and vice versa", () => {
  const context = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000003",
    model: "test/model",
    systemPrompt: "trusted contract",
    promptVersion: "v1",
    capabilityConfig: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening" as const,
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state: new Map(),
    signal: new AbortController().signal,
    events: { append: async () => { throw new Error("not used"); } },
  };

  const interviewTools = interviewCapability.createToolRegistry(context).schemas().map((s) => s.name);
  assert.ok(interviewTools.includes("retrieve_resume_evidence"));
  assert.ok(interviewTools.includes("retrieve_interview_history"));
  assert.ok(interviewTools.includes("submit_interview_action"));
  assert.equal(interviewTools.includes("read_file"), false);
  assert.equal(interviewTools.includes("write_file"), false);

  const workspaceTools = workspaceCapability.createToolRegistry({
    ...context,
    capabilityConfig: { workspaceRoot: "/tmp/fake-workspace" },
  }).schemas().map((s) => s.name);
  assert.equal(workspaceTools.includes("retrieve_resume_evidence"), false);
  assert.equal(workspaceTools.includes("retrieve_interview_history"), false);
  assert.equal(workspaceTools.includes("submit_interview_action"), false);
  assert.ok(workspaceTools.includes("read_file"));
});

test("retrieval tool execution delegates with strict parameters and handles ownership isolation", async () => {
  let capturedEvidenceCall: unknown;
  let capturedHistoryCall: unknown;

  const registry = createInterviewToolRegistry({
    async loadEvidence(input) {
      capturedEvidenceCall = input;
      if (input.userId !== "valid-user") throw new Error("Interview resume snapshot is unauthorized or not found");
      return {
        status: "success",
        count: 1,
        evidence: [{ id: "ev_1111111111111111", path: "skills[0]", text: "TypeScript" }],
      };
    },
    async loadHistory(input) {
      capturedHistoryCall = input;
      if (input.userId !== "valid-user") throw new Error("Interview history is unauthorized or not found");
      return {
        status: "success",
        count: 1,
        history: [{
          sequence: 1,
          kind: "main",
          topic: "Architecture",
          question: "Explain microservices tradeoffs.",
          answer: "Higher operational complexity but independent scaling.",
          skipped: false,
        }],
      };
    },
  });

  const tools = registry.toAISDKTools({
    userId: "valid-user",
    sessionId: "session-1",
    agentRunId: "run-1",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "answer",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state: new Map(),
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  const evidenceResult = await tools.retrieve_resume_evidence.execute?.({ query: "TypeScript", limit: 2 }, {} as never);
  assert.deepEqual(evidenceResult, {
    status: "success",
    count: 1,
    evidence: [{ id: "ev_1111111111111111", path: "skills[0]", text: "TypeScript" }],
  });
  assert.deepEqual(capturedEvidenceCall, {
    userId: "valid-user",
    sessionId: "session-1",
    interviewId: "00000000-0000-4000-8000-000000000004",
    query: "TypeScript",
    evidenceIds: undefined,
    limit: 2,
  });

  const historyResult = await tools.retrieve_interview_history.execute?.({ topic: "Architecture" }, {} as never);
  assert.deepEqual(historyResult, {
    status: "success",
    count: 1,
    history: [{
      sequence: 1,
      kind: "main",
      topic: "Architecture",
      question: "Explain microservices tradeoffs.",
      answer: "Higher operational complexity but independent scaling.",
      skipped: false,
    }],
  });
  assert.deepEqual(capturedHistoryCall, {
    userId: "valid-user",
    sessionId: "session-1",
    interviewId: "00000000-0000-4000-8000-000000000004",
    currentInterviewRunId: "00000000-0000-4000-8000-000000000005",
    query: undefined,
    topic: "Architecture",
    limit: 5,
  });

  // Unauthorized access fails closed
  const unauthorizedEvidenceTools = registry.toAISDKTools({
    userId: "attacker-user",
    sessionId: "session-1",
    agentRunId: "run-1",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "answer",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state: new Map(),
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  await assert.rejects(
    unauthorizedEvidenceTools.retrieve_resume_evidence.execute?.({ query: "TypeScript" }, {} as never),
    /unauthorized or not found/,
  );

  const unauthorizedHistoryTools = registry.toAISDKTools({
    userId: "attacker-user",
    sessionId: "session-1",
    agentRunId: "run-1",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "answer",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state: new Map(),
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  await assert.rejects(
    unauthorizedHistoryTools.retrieve_interview_history.execute?.({ topic: "Architecture" }, {} as never),
    /unauthorized or not found/,
  );
});

test("model input projection preserves paired retrieval tools and drops orphaned messages", () => {
  const assistantCall: ModelMessage = {
    role: "assistant",
    content: [
      { type: "reasoning", text: "I need to check candidate experience on distributed queues." },
      { type: "tool-call", toolCallId: "call-evidence-1", toolName: "retrieve_resume_evidence", input: { query: "Kafka" } },
    ],
  };
  const toolResult: ModelMessage = {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call-evidence-1",
      toolName: "retrieve_resume_evidence",
      output: {
        type: "json",
        value: {
          status: "success",
          count: 1,
          evidence: [{ id: "ev_kafka_01234567", path: "experience[0].bullets[2]", text: "Built Kafka ingestion pipeline" }],
        },
      },
    }],
  };

  const pairedEvents = [
    mockEvent(1, "user_message", { message: { role: "user", content: "Interview context" } }),
    mockEvent(2, "assistant_message", { message: assistantCall }),
    mockEvent(3, "tool_called", { toolCallId: "call-evidence-1", toolName: "retrieve_resume_evidence" }),
    mockEvent(4, "tool_result_message", { message: toolResult }),
  ];

  const pairedProjection = projectModelInput(pairedEvents, { activeRunId: "run-1" });
  assert.equal(pairedProjection.messages.length, 3);
  assert.deepEqual(pairedProjection.surfaceSequences, [1, 2, 4]);

  // Orphaned tool call (missing tool result) is dropped cleanly
  const orphanedCallEvents = [
    mockEvent(1, "user_message", { message: { role: "user", content: "Interview context" } }),
    mockEvent(2, "assistant_message", { message: assistantCall }),
  ];
  const orphanedCallProjection = projectModelInput(orphanedCallEvents, { activeRunId: "run-1" });
  assert.deepEqual(orphanedCallProjection.messages, [{ role: "user", content: "Interview context" }]);

  // Orphaned tool result (missing tool call) is dropped cleanly
  const orphanedResultEvents = [
    mockEvent(1, "user_message", { message: { role: "user", content: "Interview context" } }),
    mockEvent(2, "tool_result_message", { message: toolResult }),
  ];
  const orphanedResultProjection = projectModelInput(orphanedResultEvents, { activeRunId: "run-1" });
  assert.deepEqual(orphanedResultProjection.messages, [{ role: "user", content: "Interview context" }]);
});

test("oversized retrieval results trigger spill lifecycle in context preparation", async () => {
  const hugeText = "X".repeat(TOOL_RESULT_SPILL_CHARS + 2_000);
  const largeToolResult: ModelMessage = {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call-large-1",
      toolName: "retrieve_resume_evidence",
      output: {
        type: "json",
        value: { status: "success", count: 1, evidence: [{ id: "ev_1", path: "exp[0]", text: hugeText }] },
      },
    }],
  };

  const assistantCall: ModelMessage = {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call-large-1", toolName: "retrieve_resume_evidence", input: { query: "large" } }],
  };

  const storedEvents: AgentEvent[] = [
    mockEvent(1, "user_message", { message: { role: "user", content: "Interview context" } }),
    mockEvent(2, "assistant_message", { message: assistantCall }),
    mockEvent(3, "tool_result_message", { message: largeToolResult }),
  ];

  const appended: AgentEvent[] = [];
  const fakeStore = {
    async load() {
      return [...storedEvents, ...appended];
    },
    async append(input: { sessionId: string; runId: string; type: AgentEventType; payload: Record<string, unknown> }) {
      const seq = storedEvents.length + appended.length + 1;
      const evt = mockEvent(seq, input.type, input.payload, input.runId);
      appended.push(evt);
      return evt;
    },
    async appendAtomic(input: { sessionId: string; runId: string; events: Array<{ type: AgentEventType; payload: Record<string, unknown> }> }) {
      return Promise.all(input.events.map((e) => this.append({ sessionId: input.sessionId, runId: input.runId, type: e.type, payload: e.payload })));
    },
  };

  const result = await prepareModelContext({
    sessionId: "session-1",
    runId: "run-1",
    model: "test/model",
    system: "trusted system instruction",
    toolSchemas: [],
    signal: new AbortController().signal,
    store: fakeStore,
  });

  // Verify that spill event was emitted
  const spillEvent = appended.find((e) => e.type === "tool_result_spilled");
  assert.ok(spillEvent, "Expected tool_result_spilled event to be generated for large retrieval result");
  assert.deepEqual(spillEvent.payload.shadowedSequences, [3]);

  // Verify that model surface contains cropped preview with omission marker
  const toolMsg = result.messages.find((m) => m.role === "tool");
  assert.ok(toolMsg);
  const toolMsgString = JSON.stringify(toolMsg);
  assert.match(toolMsgString, /spilled to the durable event log/);
  assert.ok(toolMsgString.length < hugeText.length);
});

test("interview agent can invoke retrieval tools in step 1 and commit domain action in step 2", async () => {
  const { runAgent } = await import("@/lib/agent/runtime");
  const { AgentCapabilityRegistry } = await import("@/lib/agent/capabilities/registry");

  let committedQuestionId: string | null = null;
  const customRegistry = createInterviewToolRegistry({
    async loadEvidence(input) {
      return {
        status: "success",
        count: 1,
        evidence: [{ id: "ev_0123456789abcdef", path: "skills[0]", text: `Found ${input.query ?? "skills"}` }],
      };
    },
    async commitAction() {
      committedQuestionId = "00000000-0000-4000-8000-000000000099";
      return { id: committedQuestionId, sequence: 1 };
    },
  });

  const customCapability = {
    ...interviewCapability,
    createToolRegistry(context: Parameters<typeof interviewCapability.createToolRegistry>[0]) {
      const toolContext = {
        userId: context.userId,
        sessionId: context.sessionId,
        agentRunId: context.runId,
        config: {
          interviewId: "00000000-0000-4000-8000-000000000004",
          interviewRunId: "00000000-0000-4000-8000-000000000005",
          triggerType: "opening" as const,
          attemptGeneration: 1,
        leaseOwner: "00000000-0000-4000-8000-000000000001",
        },
        state: context.state,
        skillLoadStep: 1,
        signal: context.signal,
      };
      return {
        schemas: customRegistry.schemas.bind(customRegistry),
        toAISDKTools: () => customRegistry.toAISDKTools(toolContext),
        toolOrder: ["retrieve_resume_evidence", "retrieve_interview_history", "submit_interview_action"],
      };
    },
  };

  const capabilities = new AgentCapabilityRegistry();
  capabilities.register(customCapability);

  const provider = {
    model: {} as import("ai").LanguageModel,
    metadata: {
      provider: "deepseek" as const,
      model: "deepseek/deepseek-chat",
      modelId: "deepseek-chat",
      structuredOutput: "json-object" as const,
      thinking: "enabled" as const,
      contextWindow: 64_000,
    },
  };

  const emittedEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let currentStep = 0;

  const fakeStream = ((options: Parameters<typeof import("ai").streamText>[0]) => {
    currentStep += 1;
    const stepNum = currentStep;
    const stream = (async function* () {
      if (stepNum === 1) {
        // Step 1: Model calls retrieve_resume_evidence
        yield {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "retrieve_resume_evidence",
          input: { query: "TypeScript" },
        };
        const toolOutput = await (options.tools as Record<string, { execute?: (input: unknown) => Promise<unknown> }>).retrieve_resume_evidence.execute?.({ query: "TypeScript" });
        yield {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "retrieve_resume_evidence",
          output: toolOutput,
        };
        await options.onStepEnd?.({
          content: [
            { type: "tool-call", toolCallId: "call-1", toolName: "retrieve_resume_evidence", input: { query: "TypeScript" } },
          ],
          response: {
            messages: [
              { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "retrieve_resume_evidence", input: { query: "TypeScript" } }] },
              { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "retrieve_resume_evidence", output: toolOutput }] },
            ],
          },
        } as never);
        yield { type: "finish-step", finishReason: "tool-calls", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
      } else {
        // Step 2: Model calls submit_interview_action
        const proposal = {
          answerAnalysis: null,
          action: {
            type: "ask_question",
            kind: "main",
            question: "请谈谈你在项目中应用 TypeScript 的实践。",
            topic: "技术深度",
            resumeEvidenceIds: ["ev_0123456789abcdef"],
          },
        };
        yield {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "submit_interview_action",
          input: proposal,
        };
        const actionOutput = await (options.tools as Record<string, { execute?: (input: unknown) => Promise<unknown> }>).submit_interview_action.execute?.(proposal);
        yield {
          type: "tool-result",
          toolCallId: "call-2",
          toolName: "submit_interview_action",
          output: actionOutput,
        };
        await options.onStepEnd?.({
          content: [
            { type: "tool-call", toolCallId: "call-2", toolName: "submit_interview_action", input: proposal },
          ],
          response: {
            messages: [
              { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-2", toolName: "submit_interview_action", input: proposal }] },
            ],
          },
        } as never);
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } };
      }
    })();
    return { stream, totalUsage: Promise.resolve({ inputTokens: 30, outputTokens: 15, totalTokens: 45 }) };
  }) as unknown as typeof import("ai").streamText;

  const { AgentSkillRegistry } = await import("@/lib/agent/skills/registry");
  const skills = new AgentSkillRegistry();

  await runAgent({
    sessionId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000003",
    capability: "interview",
    promptVersion: interviewCapability.promptVersion,
    model: "deepseek/deepseek-chat",
    systemPrompt: "trusted contract",
    capabilityConfig: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    maxSteps: 3,
    signal: new AbortController().signal,
    events: {
      append: async (type, payload) => {
        emittedEvents.push({ type, payload });
        return {
          id: emittedEvents.length,
          sessionId: "00000000-0000-4000-8000-000000000001",
          runId: "00000000-0000-4000-8000-000000000002",
          sequence: emittedEvents.length,
          type,
          payload,
          dedupeKey: null,
          schemaVersion: 1,
          visibility: "model",
          createdAt: new Date(),
        };
      },
    },
  }, {
    capabilities,
    skills,
    provider,
    loadEvents: async () => [],
    stream: fakeStream,
    prepareContext: async () => ({
      events: [],
      messages: [{ role: "user", content: "interview context" }],
      estimatedTokens: 100,
      contextWindow: 64_000,
      maxOutputTokens: 1_000,
      compacted: false,
    }),
  });

  assert.equal(currentStep, 2);
  assert.equal(committedQuestionId, "00000000-0000-4000-8000-000000000099");
  assert.ok(emittedEvents.some((e) => e.type === "tool_called" && e.payload.toolName === "retrieve_resume_evidence"));
  assert.ok(emittedEvents.some((e) => e.type === "tool_completed" && e.payload.toolName === "retrieve_resume_evidence"));
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("Test A: two concurrent retrievals maintain independent active states, fence same step submit, and allow next step", async () => {
  const state = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 2],
  ]);

  const deferredA = createDeferred<z.infer<typeof retrieveResumeEvidenceOutputSchema>>();
  const deferredB = createDeferred<z.infer<typeof retrieveInterviewHistoryOutputSchema>>();

  let commitCalls = 0;
  const registry = createInterviewToolRegistry({
    loadEvidence: async () => deferredA.promise,
    loadHistory: async () => deferredB.promise,
    commitAction: async () => {
      commitCalls += 1;
      return { id: "00000000-0000-4000-8000-000000000099", sequence: 1 };
    },
  });

  const tools = registry.toAISDKTools({
    userId: "valid-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  const proposal = {
    answerAnalysis: null,
    action: {
      type: "ask_question" as const,
      kind: "main" as const,
      question: "Question text",
      topic: "Topic",
      resumeEvidenceIds: ["ev_0123456789abcdef"],
    },
  };

  // 1. 同一步启动 retrieval A 和 B
  const promiseA = tools.retrieve_resume_evidence.execute!({ query: "React" }, {} as never);
  const promiseB = tools.retrieve_interview_history.execute!({ query: "architecture" }, {} as never);

  // 2. 两者都在 pending 中，确认同一步存在 retrieval 活动
  assert.equal(hasSameStepRetrievalActivity({ state } as never), true);

  // 3. A 先以非成功（可修复业务参数错误）结束
  deferredA.reject(new RepairableInterviewRetrievalError("No evidence found"));
  await assert.rejects(promiseA, /No evidence found/);

  // 4. 确认 B 仍然被记录为 active
  assert.equal(hasSameStepRetrievalActivity({ state } as never), true);

  // 5. 此时调用 submit，必须被拒绝，commitAction 调用为 0
  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    /Retrieved data must be consumed in the next model step before submitting an interview action/,
  );
  assert.equal(commitCalls, 0);

  // 6. B 完成后，同一步 submit 仍因 completed retrieval 被拒绝
  deferredB.resolve({
    status: "success",
    count: 1,
    history: [{
      sequence: 1,
      kind: "main",
      topic: "Topic",
      question: "Q1",
      answer: "A1",
      skipped: false,
    }],
  });
  const resB = await promiseB;
  assert.deepEqual(resB, {
    status: "success",
    count: 1,
    history: [{
      sequence: 1,
      kind: "main",
      topic: "Topic",
      question: "Q1",
      answer: "A1",
      skipped: false,
    }],
  });

  assert.equal(hasSameStepRetrievalActivity({ state } as never), true);
  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    /Retrieved data must be consumed in the next model step before submitting an interview action/,
  );
  assert.equal(commitCalls, 0);

  // 7. 进入下一 step 后才允许 submit
  state.set(CURRENT_AGENT_STEP, 3);
  assert.equal(hasSameStepRetrievalActivity({ state } as never), false);
  const submitResult = await tools.submit_interview_action.execute!(proposal, {} as never);
  assert.deepEqual(submitResult, {
    status: "committed",
    action: "ask_question",
    questionId: "00000000-0000-4000-8000-000000000099",
  });
  assert.equal(commitCalls, 1);
});

test("Test B: fatal retrieval failure marks latch fatal and blocks submit without calling commit dependency", async () => {
  const state = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 1],
  ]);

  let commitCalls = 0;
  const registry = createInterviewToolRegistry({
    loadEvidence: async () => {
      throw new Error("Interview resume snapshot is unauthorized or not found");
    },
    commitAction: async () => {
      commitCalls += 1;
      return { id: "00000000-0000-4000-8000-000000000099", sequence: 1 };
    },
  });

  const tools = registry.toAISDKTools({
    userId: "attacker-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  // 1. retrieval 返回 authorization fatal error
  await assert.rejects(
    tools.retrieve_resume_evidence.execute!({ query: "test" }, {} as never),
    /unauthorized or not found/,
  );

  // 2. 确认 fatal 状态已经设置
  assert.equal(state.get(INTERVIEW_FATAL_ACTION_ERROR), true);
  assert.equal(getTerminalLatch({ state } as never), "fatal");

  // 3 & 4. 不调用 afterStep，立即调用真实 submit
  const proposal = {
    answerAnalysis: null,
    action: {
      type: "ask_question" as const,
      kind: "main" as const,
      question: "Question text",
      topic: "Topic",
      resumeEvidenceIds: ["ev_0123456789abcdef"],
    },
  };

  // 5. 确认 submit 被拒绝，commit dependency 调用次数为 0
  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    /Interview agent is in a fatal error state/,
  );
  assert.equal(commitCalls, 0);
});

test("Test C: concurrent retrieval and submit rejects submit before invoking commit dependency", async () => {
  const state = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 2],
  ]);

  const deferredRetrieval = createDeferred<z.infer<typeof retrieveResumeEvidenceOutputSchema>>();
  let commitCalls = 0;

  const registry = createInterviewToolRegistry({
    loadEvidence: async () => deferredRetrieval.promise,
    commitAction: async () => {
      commitCalls += 1;
      return { id: "00000000-0000-4000-8000-000000000099", sequence: 1 };
    },
  });

  const tools = registry.toAISDKTools({
    userId: "valid-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  const proposal = {
    answerAnalysis: null,
    action: {
      type: "ask_question" as const,
      kind: "main" as const,
      question: "Question text",
      topic: "Topic",
      resumeEvidenceIds: ["ev_0123456789abcdef"],
    },
  };

  // 1. retrieval 先登记 active，保持 pending
  const retrievalPromise = tools.retrieve_resume_evidence.execute!({ query: "Kafka" }, {} as never);
  assert.equal(hasSameStepRetrievalActivity({ state } as never), true);

  // 2 & 3. 启动 submit，必须在调用 commit dependency 前失败
  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    /Retrieved data must be consumed in the next model step before submitting an interview action/,
  );

  // 4. commit 调用次数必须为 0
  assert.equal(commitCalls, 0);

  // 清理 pending retrieval
  deferredRetrieval.resolve({
    status: "success",
    count: 0,
    evidence: [],
  });
  await retrievalPromise;
});

test("Test D: dual submit concurrency permits only first commit, rejects second immediately, and blocks subsequent calls", async () => {
  const state = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 2],
  ]);

  const deferredCommit = createDeferred<{ id: string; sequence: number }>();
  let commitCalls = 0;

  const registry = createInterviewToolRegistry({
    commitAction: async () => {
      commitCalls += 1;
      return deferredCommit.promise;
    },
    loadEvidence: async () => ({ status: "success", count: 0, evidence: [] }),
    loadHistory: async () => ({ status: "success", count: 0, history: [] }),
  });

  const tools = registry.toAISDKTools({
    userId: "valid-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  const proposal = {
    answerAnalysis: null,
    action: {
      type: "ask_question" as const,
      kind: "main" as const,
      question: "Question text",
      topic: "Topic",
      resumeEvidenceIds: ["ev_0123456789abcdef"],
    },
  };

  // 1. 第一个真实 submit 获取 latch，commit dependency 保持 pending
  const submitPromise1 = tools.submit_interview_action.execute!(proposal, {} as never);
  assert.equal(getTerminalLatch({ state } as never), "committing");

  // 2 & 3. 并发启动第二个 submit，第二个必须立即失败
  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    /already committing/,
  );

  // 4. 释放第一个提交
  deferredCommit.resolve({ id: "00000000-0000-4000-8000-000000000099", sequence: 1 });
  const res1 = await submitPromise1;
  assert.deepEqual(res1, {
    status: "committed",
    action: "ask_question",
    questionId: "00000000-0000-4000-8000-000000000099",
  });

  // 5. 确认 commit dependency 只调用一次
  assert.equal(commitCalls, 1);
  assert.equal(getTerminalLatch({ state } as never), "committed");

  // 6. 提交成功后第三次 submit 和任何 retrieval 都必须失败
  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    /already been committed/,
  );
  await assert.rejects(
    tools.retrieve_resume_evidence.execute!({ query: "test" }, {} as never),
    /Cannot retrieve evidence after an interview action has started committing/,
  );
  await assert.rejects(
    tools.retrieve_interview_history.execute!({ limit: 1 }, {} as never),
    /Cannot retrieve history after an interview action has started committing/,
  );
  assert.equal(commitCalls, 1);
});

test("Test E: infrastructure errors in retrieval and commit default to fatal, locking latch immediately", async () => {
  // E1: Retrieval infrastructure failure
  const stateRetrieval = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 1],
  ]);
  let commitCallsRetrieval = 0;

  const registryRetrieval = createInterviewToolRegistry({
    loadEvidence: async () => {
      throw new Error("PostgreSQL connection terminated unexpectedly");
    },
    commitAction: async () => {
      commitCallsRetrieval += 1;
      return { id: "00000000-0000-4000-8000-000000000099", sequence: 1 };
    },
  });

  const toolsRetrieval = registryRetrieval.toAISDKTools({
    userId: "valid-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state: stateRetrieval,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  await assert.rejects(
    toolsRetrieval.retrieve_resume_evidence.execute!({ query: "test" }, {} as never),
    /connection terminated unexpectedly/,
  );

  // 必须设置 fatal，latch 必须进入 fatal
  assert.equal(stateRetrieval.get(INTERVIEW_FATAL_ACTION_ERROR), true);
  assert.equal(getTerminalLatch({ state: stateRetrieval } as never), "fatal");

  // 不依赖 afterStep，后续 submit / retrieval 必须全部拒绝
  const proposal = {
    answerAnalysis: null,
    action: {
      type: "ask_question" as const,
      kind: "main" as const,
      question: "Question text",
      topic: "Topic",
      resumeEvidenceIds: ["ev_0123456789abcdef"],
    },
  };
  await assert.rejects(
    toolsRetrieval.submit_interview_action.execute!(proposal, {} as never),
    /Interview agent is in a fatal error state/,
  );
  await assert.rejects(
    toolsRetrieval.retrieve_resume_evidence.execute!({ query: "test" }, {} as never),
    /Interview agent is in a fatal error state/,
  );
  assert.equal(commitCallsRetrieval, 0);

  // E2: Commit infrastructure failure
  const stateCommit = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 2],
  ]);

  const registryCommit = createInterviewToolRegistry({
    commitAction: async () => {
      throw new Error("Disk I/O failure during commit");
    },
    loadEvidence: async () => ({ status: "success", count: 0, evidence: [] }),
  });

  const toolsCommit = registryCommit.toAISDKTools({
    userId: "valid-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state: stateCommit,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });

  await assert.rejects(
    toolsCommit.submit_interview_action.execute!(proposal, {} as never),
    /Disk I\/O failure during commit/,
  );

  // 必须设置 fatal，latch 必须进入 fatal
  assert.equal(stateCommit.get(INTERVIEW_FATAL_ACTION_ERROR), true);
  assert.equal(getTerminalLatch({ state: stateCommit } as never), "fatal");

  // 后续 submit / retrieval 必须全部拒绝
  await assert.rejects(
    toolsCommit.submit_interview_action.execute!(proposal, {} as never),
    /Interview agent is in a fatal error state/,
  );
  await assert.rejects(
    toolsCommit.retrieve_resume_evidence.execute!({ query: "test" }, {} as never),
    /Interview agent is in a fatal error state/,
  );
});

test("fatal state raised while commit is pending cannot be overwritten by committed", async () => {
  const state = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 2],
  ]);
  const commitStarted = createDeferred<void>();
  const releaseCommit = createDeferred<void>();
  const registry = createInterviewToolRegistry({
    commitAction: async () => {
      commitStarted.resolve();
      await releaseCommit.promise;
      return { id: "00000000-0000-4000-8000-000000000099", sequence: 1 };
    },
  });
  const tools = registry.toAISDKTools({
    userId: "valid-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });
  const proposal = {
    answerAnalysis: null,
    action: {
      type: "ask_question" as const,
      kind: "main" as const,
      question: "Question text",
      topic: "Topic",
      resumeEvidenceIds: ["ev_0123456789abcdef"],
    },
  };

  const pendingSubmit = tools.submit_interview_action.execute!(proposal, {} as never);
  await commitStarted.promise;
  state.set(INTERVIEW_FATAL_ACTION_ERROR, true);
  releaseCommit.resolve();

  await assert.rejects(pendingSubmit, /entered a fatal state during domain commit/);
  assert.equal(getTerminalLatch({ state } as never), "fatal");
  assert.equal(state.has(INTERVIEW_ACTION_COMMITTED), false);
});

test("an internal ZodError from commit defaults to fatal", async () => {
  const state = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 2],
  ]);
  const registry = createInterviewToolRegistry({
    commitAction: async () => z.string().parse(42) as never,
  });
  const tools = registry.toAISDKTools({
    userId: "valid-user",
    sessionId: "00000000-0000-4000-8000-000000000001",
    agentRunId: "00000000-0000-4000-8000-000000000002",
    config: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    leaseOwner: "00000000-0000-4000-8000-000000000001",
    },
    state,
    skillLoadStep: 1,
    signal: new AbortController().signal,
  });
  const proposal = {
    answerAnalysis: null,
    action: {
      type: "ask_question" as const,
      kind: "main" as const,
      question: "Question text",
      topic: "Topic",
      resumeEvidenceIds: ["ev_0123456789abcdef"],
    },
  };

  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    z.ZodError,
  );
  assert.equal(getTerminalLatch({ state } as never), "fatal");
  await assert.rejects(
    tools.submit_interview_action.execute!(proposal, {} as never),
    /Interview agent is in a fatal error state/,
  );
});
