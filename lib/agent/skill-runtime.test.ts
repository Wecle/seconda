import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModel, ModelMessage } from "ai";
import type { ProviderModel } from "@/lib/ai/provider-registry";
import { AgentCapabilityRegistry } from "./capabilities/registry";
import { AGENT_TERMINAL_ACTION_LATCH } from "./capabilities/types";
import type { AgentEvent, AgentEventType } from "./types";
import { projectModelInput } from "./model-input";
import { runAgent } from "./runtime";
import { AgentSkillRegistry, SkillRegistryError } from "./skills/registry";
import { createStaticSkillProvider } from "./skills/static-provider";
import { SKILL_LOAD_FAILED, SKILL_TERMINAL_ACTION_ACTIVE } from "./skills/tool";
import { interviewCapability } from "@/lib/interview/agent/capability";

test("runtime injects a scoped catalog and carries an on-demand skill result into the next step", async () => {
  const capabilities = new AgentCapabilityRegistry();
  capabilities.register({
    id: "skill-test",
    promptVersion: "skill-test-v1",
    maxSteps: 2,
    skillAllowlist: ["resume-deep-dive"],
    createContextProviders: () => [{
      id: "contract", order: 1,
      provide: () => ({ id: "base", order: 1, title: "Contract", content: "Keep authority in code.", trust: "trusted-instruction" }),
    }],
    createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
    afterStep: ({ step }) => step === 1 ? { action: "continue" } : { action: "stop", reason: "done" },
  });
  const skills = new AgentSkillRegistry();
  skills.registerProvider(createStaticSkillProvider("built-ins", [{
    name: "resume-deep-dive",
    description: "Probe one resume claim.",
    version: "1.0.0",
    instructions: "Ask about personal ownership and one rejected alternative.",
  }, {
    name: "workspace-inspection",
    description: "Inspect workspace files.",
    version: "1.0.0",
    instructions: "Read files.",
  }]));
  const provider: ProviderModel = {
    model: {} as LanguageModel,
    metadata: {
      provider: "openai", model: "openai/gpt-5-mini", modelId: "gpt-5-mini",
      structuredOutput: "json-schema", thinking: "not-configured", contextWindow: 4_000,
    },
  };
  const events: AgentEvent[] = [];
  let streamStep = 0;
  let secondStepMessages: readonly ModelMessage[] = [];
  let renderedSystem = "";
  let measuredToolSchemas: unknown;
  let receivedProviderOptions: unknown;
  const fakeStream = ((options: Parameters<typeof import("ai").streamText>[0]) => {
    streamStep += 1;
    renderedSystem = String(options.system);
    receivedProviderOptions = options.providerOptions;
    const currentStep = streamStep;
    const stream = (async function* () {
      yield { type: "start-step" };
      if (currentStep === 1) {
        const execute = options.tools?.skill?.execute;
        assert.ok(execute);
        const output = await execute({ name: "resume-deep-dive" }, {} as never);
        const responseMessages = [
          {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "skill-call", toolName: "skill", input: { name: "resume-deep-dive" } }],
          },
          {
            role: "tool",
            content: [{ type: "tool-result", toolCallId: "skill-call", toolName: "skill", output: { type: "json", value: output } }],
          },
        ] as unknown as ModelMessage[];
        await options.onStepEnd?.({ content: [{ type: "tool-result" }], response: { messages: responseMessages } } as never);
        yield { type: "tool-call", toolCallId: "skill-call", toolName: "skill", input: { name: "resume-deep-dive" } };
        yield { type: "tool-result", toolCallId: "skill-call", toolName: "skill", output };
      } else {
        secondStepMessages = options.messages ?? [];
        const responseMessages: ModelMessage[] = [{ role: "assistant", content: "done" }];
        await options.onStepEnd?.({ content: [{ type: "text", text: "done" }], response: { messages: responseMessages } } as never);
      }
      yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    })();
    return { stream, totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }) };
  }) as unknown as typeof import("ai").streamText;

  await runAgent({
    sessionId: "session", runId: "run", userId: "user", capability: "skill-test",
    promptVersion: "skill-test-v1", model: "openai/gpt-5-mini", systemPrompt: "contract",
    capabilityConfig: null, maxSteps: 2, signal: new AbortController().signal,
    events: {
      async append(type: AgentEventType, payload: Record<string, unknown>) {
        const event: AgentEvent = {
          id: events.length + 1, sessionId: "session", runId: "run", sequence: events.length + 1,
          type, payload, dedupeKey: null, schemaVersion: 1, visibility: "model", createdAt: new Date(0),
        };
        events.push(event);
        return event;
      },
    },
  }, {
    capabilities,
    skills,
    loadEvents: async () => events,
    provider,
    stream: fakeStream,
    prepareContext: async (input) => {
      measuredToolSchemas = input.toolSchemas;
      return {
        events,
        messages: projectModelInput(events, { activeRunId: input.runId }).messages,
        estimatedTokens: 100,
        contextWindow: 4_000,
        maxOutputTokens: 500,
        compacted: false,
      };
    },
  });

  assert.equal(streamStep, 2);
  assert.match(renderedSystem, /resume-deep-dive: Probe one resume claim\./);
  assert.doesNotMatch(renderedSystem, /personal ownership/);
  assert.doesNotMatch(renderedSystem, /workspace-inspection/);
  assert.match(JSON.stringify(measuredToolSchemas), /"name":"skill"/);
  assert.deepEqual(receivedProviderOptions, { openai: { parallelToolCalls: false } });
  assert.match(JSON.stringify(secondStepMessages), /personal ownership/);
  assert.deepEqual(events.filter(({ type }) => type === "skill_catalog_snapshotted").length, 1);
  assert.deepEqual(events.filter(({ type }) => type === "skill_loaded").length, 1);
  const traced = events.find(({ type }) => type === "tool_completed")?.payload.output;
  assert.doesNotMatch(JSON.stringify(traced), /personal ownership/);
});

test("runtime stops an interview when Skill input validation fails before execution", async () => {
  const capabilities = new AgentCapabilityRegistry();
  capabilities.register(interviewCapability);
  const skills = new AgentSkillRegistry();
  skills.registerProvider(createStaticSkillProvider("built-ins", [{
    name: "resume-deep-dive",
    description: "Probe one resume claim.",
    version: "1.0.0",
    instructions: "Ask about personal ownership.",
  }]));
  const provider: ProviderModel = {
    model: {} as LanguageModel,
    metadata: {
      provider: "deepseek", model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
      structuredOutput: "json-object", thinking: "enabled", contextWindow: 4_000,
    },
  };
  const events: AgentEvent[] = [];
  let streamSteps = 0;
  const fakeStream = ((options: Parameters<typeof import("ai").streamText>[0]) => {
    streamSteps += 1;
    assert.ok(options.tools?.skill);
    const stream = (async function* () {
      yield { type: "start-step" };
      await options.onStepEnd?.({
        content: [{ type: "tool-error", toolCallId: "bad-skill", toolName: "skill", input: {}, error: new Error("Invalid input") }],
        response: { messages: [] },
      } as never);
      yield { type: "tool-error", toolCallId: "bad-skill", toolName: "skill", input: {}, error: new Error("Invalid input") };
      yield { type: "finish-step", finishReason: "error", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    })();
    return { stream, totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }) };
  }) as unknown as typeof import("ai").streamText;

  await runAgent({
    sessionId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000003",
    capability: "interview",
    promptVersion: interviewCapability.promptVersion,
    model: "deepseek/deepseek-chat",
    systemPrompt: "contract",
    capabilityConfig: {
      interviewId: "00000000-0000-4000-8000-000000000004",
      interviewRunId: "00000000-0000-4000-8000-000000000005",
      triggerType: "opening",
      attemptGeneration: 1,
    },
    maxSteps: 3,
    signal: new AbortController().signal,
    events: {
      async append(type: AgentEventType, payload: Record<string, unknown>) {
        const event: AgentEvent = {
          id: events.length + 1,
          sessionId: "00000000-0000-4000-8000-000000000001",
          runId: "00000000-0000-4000-8000-000000000002",
          sequence: events.length + 1,
          type,
          payload,
          dedupeKey: null,
          schemaVersion: 1,
          visibility: "model",
          createdAt: new Date(0),
        };
        events.push(event);
        return event;
      },
    },
  }, {
    capabilities,
    skills,
    loadEvents: async () => events,
    provider,
    stream: fakeStream,
    prepareContext: async () => ({
      events,
      messages: [],
      estimatedTokens: 100,
      contextWindow: 4_000,
      maxOutputTokens: 500,
      compacted: false,
    }),
  });

  assert.equal(streamSteps, 1);
  assert.equal(events.filter(({ type }) => type === "skill_load_failed").length, 1);
  assert.equal(events.some(({ type }) => type === "interview/question_committed"), false);
});

test("runtime preserves terminal-action priority when a late Skill call is rejected", async () => {
  const capabilities = new AgentCapabilityRegistry();
  capabilities.register({
    id: "terminal-skill-test",
    promptVersion: "terminal-skill-test-v1",
    maxSteps: 2,
    skillAllowlist: ["resume-deep-dive"],
    createContextProviders: () => [],
    createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
    beforeStep(context) {
      context.state.set(AGENT_TERMINAL_ACTION_LATCH, "committing");
      return { action: "continue" };
    },
    afterStep(context) {
      return context.state.has(SKILL_LOAD_FAILED)
        ? { action: "continue" }
        : { action: "stop", reason: "terminal-action-won" };
    },
  });
  const skills = new AgentSkillRegistry();
  skills.registerProvider(createStaticSkillProvider("built-ins", [{
    name: "resume-deep-dive",
    description: "Probe one resume claim.",
    version: "1.0.0",
    instructions: "Ask about personal ownership.",
  }]));
  const provider: ProviderModel = {
    model: {} as LanguageModel,
    metadata: {
      provider: "deepseek", model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
      structuredOutput: "json-object", thinking: "enabled", contextWindow: 4_000,
    },
  };
  const events: AgentEvent[] = [];
  let streamSteps = 0;
  const fakeStream = ((options: Parameters<typeof import("ai").streamText>[0]) => {
    streamSteps += 1;
    const rejection = new SkillRegistryError(
      SKILL_TERMINAL_ACTION_ACTIVE,
      "Skill cannot start while a terminal action is committing",
    );
    const stream = (async function* () {
      yield { type: "start-step" };
      await options.onStepEnd?.({
        content: [{ type: "tool-error", toolCallId: "late-skill", toolName: "skill", input: {}, error: rejection }],
        response: { messages: [] },
      } as never);
      yield { type: "tool-error", toolCallId: "late-skill", toolName: "skill", input: {}, error: rejection };
      yield { type: "finish-step", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    })();
    return { stream, totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }) };
  }) as unknown as typeof import("ai").streamText;

  await runAgent({
    sessionId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000003",
    capability: "terminal-skill-test",
    promptVersion: "terminal-skill-test-v1",
    model: "deepseek/deepseek-chat",
    systemPrompt: "contract",
    capabilityConfig: {},
    maxSteps: 2,
    signal: new AbortController().signal,
    events: {
      async append(type: AgentEventType, payload: Record<string, unknown>) {
        const event: AgentEvent = {
          id: events.length + 1,
          sessionId: "00000000-0000-4000-8000-000000000001",
          runId: "00000000-0000-4000-8000-000000000002",
          sequence: events.length + 1,
          type,
          payload,
          dedupeKey: null,
          schemaVersion: 1,
          visibility: "model",
          createdAt: new Date(0),
        };
        events.push(event);
        return event;
      },
    },
  }, {
    capabilities,
    skills,
    loadEvents: async () => events,
    provider,
    stream: fakeStream,
    prepareContext: async () => ({
      events,
      messages: [],
      estimatedTokens: 100,
      contextWindow: 4_000,
      maxOutputTokens: 500,
      compacted: false,
    }),
  });

  assert.equal(streamSteps, 1);
  assert.equal(events.filter(({ type }) => type === "skill_load_failed").length, 0);
  assert.equal(events.filter(({ type }) => type === "tool_completed").length, 1);
});

test("runtime restores the persisted catalog instead of resnapshotting the same run", async () => {
  const capabilities = new AgentCapabilityRegistry();
  capabilities.register({
    id: "resume-test", promptVersion: "v1", maxSteps: 1, skillAllowlist: ["resume-deep-dive"],
    createContextProviders: () => [],
    createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
    beforeStep: () => ({ action: "stop", reason: "snapshot-only" }),
  });
  let description = "Original description";
  let snapshots = 0;
  const skills = new AgentSkillRegistry();
  skills.registerProvider({
    id: "mutable",
    async snapshot() {
      snapshots += 1;
      return {
        complete: true,
        skills: [{
          name: "resume-deep-dive",
          description,
          version: "1",
          contentHash: "sha256:" + "a".repeat(64),
        }],
      };
    },
    async load() { return null; },
  });
  const events: AgentEvent[] = [];
  const input = {
    sessionId: "session", runId: "run", userId: "user", capability: "resume-test",
    promptVersion: "v1", model: "deepseek/deepseek-chat", systemPrompt: "contract",
    capabilityConfig: null, maxSteps: 1, signal: new AbortController().signal,
    events: {
      async append(type: AgentEventType, payload: Record<string, unknown>) {
        const event: AgentEvent = {
          id: events.length + 1, sessionId: "session", runId: "run", sequence: events.length + 1,
          type, payload, dedupeKey: null, schemaVersion: 1, visibility: "model", createdAt: new Date(0),
        };
        events.push(event);
        return event;
      },
    },
  } as const;
  const dependencies = {
    capabilities,
    skills,
    loadEvents: async () => events,
    provider: {
      model: {} as LanguageModel,
      metadata: {
        provider: "deepseek" as const, model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
        structuredOutput: "json-object" as const, thinking: "enabled" as const, contextWindow: 4_000,
      },
    },
    prepareContext: async () => ({
      events, messages: [], estimatedTokens: 0, contextWindow: 4_000, maxOutputTokens: 500, compacted: false,
    }),
  };

  await runAgent(input, dependencies);
  description = "Changed after restart";
  await runAgent(input, dependencies);
  assert.equal(snapshots, 1);
  assert.equal(events.filter(({ type }) => type === "skill_catalog_snapshotted").length, 1);
});

test("capability skill allowlists fail closed without a registry", async () => {
  const capabilities = new AgentCapabilityRegistry();
  capabilities.register({
    id: "skill-required", promptVersion: "v1", maxSteps: 1, skillAllowlist: ["resume-deep-dive"],
    createContextProviders: () => [],
    createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
  });
  await assert.rejects(runAgent({
    sessionId: "session", runId: "run", userId: "user", capability: "skill-required",
    promptVersion: "v1", model: "deepseek/deepseek-chat", systemPrompt: "contract",
    capabilityConfig: null, maxSteps: 1, signal: new AbortController().signal,
    events: { append: async () => { throw new Error("not used"); } },
  }, {
    capabilities,
    provider: {
      model: {} as LanguageModel,
      metadata: {
        provider: "deepseek", model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
        structuredOutput: "json-object", thinking: "enabled", contextWindow: 4_000,
      },
    },
  }), /requires a skill registry/);
});
