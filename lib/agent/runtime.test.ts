import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LanguageModel, ModelMessage } from "ai";
import type { ProviderModel } from "@/lib/ai/provider-registry";
import { AgentCapabilityRegistry } from "./capabilities/registry";
import { builtInCapabilityRegistry } from "./capabilities/built-ins";
import type { AgentCapability } from "./capabilities/types";
import { runAgent } from "./runtime";
import type { ContextLifecycleResult } from "./context-lifecycle";
import type { AgentEvent, AgentEventType } from "./types";

describe("agent runtime", () => {
  test("rejects unknown capabilities before preparing model context", async () => {
    const provider: ProviderModel = {
      model: {} as LanguageModel,
      metadata: {
        provider: "deepseek", model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
        structuredOutput: "json-object", thinking: "enabled", contextWindow: 2_000,
      },
    };
    await assert.rejects(runAgent({
      sessionId: "session", runId: "run", userId: "user", capability: "missing",
      promptVersion: "missing-v1", model: "deepseek/deepseek-chat", systemPrompt: "missing",
      capabilityConfig: null, maxSteps: 1, signal: new AbortController().signal,
      events: { append: async () => { throw new Error("not used"); } },
    }, { capabilities: new AgentCapabilityRegistry(), provider }), /Unknown agent capability/);
  });

  test("honors capability before/after decisions and maximum steps", async () => {
    const capabilities = new AgentCapabilityRegistry();
    const beforeSteps: number[] = [];
    const afterSteps: number[] = [];
    capabilities.register({
      id: "policy-test",
      promptVersion: "policy-v1",
      maxSteps: 2,
      createContextProviders: () => [{
        id: "contract", order: 1,
        provide: () => ({ id: "base", order: 1, title: "Contract", content: "test", trust: "trusted-instruction" }),
      }],
      createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
      beforeStep: ({ step }) => {
        beforeSteps.push(step);
        return { action: "continue" };
      },
      afterStep: ({ step }) => {
        afterSteps.push(step);
        return { action: "continue" };
      },
    });
    const provider: ProviderModel = {
      model: {} as LanguageModel,
      metadata: {
        provider: "deepseek", model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
        structuredOutput: "json-object", thinking: "enabled", contextWindow: 2_000,
      },
    };
    let streamCalls = 0;
    const fakeStream = ((options: Parameters<typeof import("ai").streamText>[0]) => {
      streamCalls += 1;
      const stream = (async function* () {
        await options.onStepEnd?.({ content: [{ type: "text", text: "continue" }], response: { messages: [] } } as never);
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      })();
      return { stream, totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }) };
    }) as unknown as typeof import("ai").streamText;
    await runAgent({
      sessionId: "session", runId: "run", userId: "user", capability: "policy-test",
      promptVersion: "policy-v1", model: "deepseek/deepseek-chat", systemPrompt: "test",
      capabilityConfig: null, maxSteps: 5, signal: new AbortController().signal,
      events: {
        async append(type, payload) {
          return { id: 1, sessionId: "session", runId: "run", sequence: 1, type, payload, createdAt: new Date(0) };
        },
      },
    }, {
      capabilities, provider, stream: fakeStream,
      prepareContext: async () => ({
        events: [], messages: [{ role: "user", content: "start" }], estimatedTokens: 1,
        contextWindow: 2_000, maxOutputTokens: 100, compacted: false,
      }),
    });
    assert.equal(streamCalls, 2);
    assert.deepEqual(beforeSteps, [1, 2]);
    assert.deepEqual(afterSteps, [1, 2]);

    const stoppingCapabilities = new AgentCapabilityRegistry();
    stoppingCapabilities.register({
      id: "stop-before-model",
      promptVersion: "stop-v1",
      maxSteps: 3,
      createContextProviders: () => [],
      createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
      beforeStep: () => ({ action: "stop", reason: "already-committed" }),
    });
    streamCalls = 0;
    await runAgent({
      sessionId: "session", runId: "run", userId: "user", capability: "stop-before-model",
      promptVersion: "stop-v1", model: "deepseek/deepseek-chat", systemPrompt: "test",
      capabilityConfig: null, maxSteps: 3, signal: new AbortController().signal,
      events: {
        async append(type, payload) {
          return { id: 1, sessionId: "session", runId: "run", sequence: 1, type, payload, createdAt: new Date(0) };
        },
      },
    }, {
      capabilities: stoppingCapabilities, provider, stream: fakeStream,
      prepareContext: async () => ({
        events: [], messages: [], estimatedTokens: 0,
        contextWindow: 2_000, maxOutputTokens: 100, compacted: false,
      }),
    });
    assert.equal(streamCalls, 0);
  });

  test("uses only the resolved capability tools when no workspace exists", async () => {
    const capabilities = new AgentCapabilityRegistry();
    const isolatedCapability: AgentCapability = {
      id: "isolated",
      promptVersion: "isolated-v1",
      maxSteps: 1,
      createContextProviders: () => [{
        id: "contract",
        order: 1,
        provide: () => ({
          id: "base",
          order: 1,
          title: "Contract",
          content: "Use no workspace tools.",
          trust: "trusted-instruction",
        }),
      }],
      createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
    };
    capabilities.register(isolatedCapability);
    const provider: ProviderModel = {
      model: {} as LanguageModel,
      metadata: {
        provider: "deepseek", model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
        structuredOutput: "json-object", thinking: "enabled", contextWindow: 2_000,
      },
    };
    let receivedToolNames: string[] | undefined;
    const fakeStream = ((options: Parameters<typeof import("ai").streamText>[0]) => {
      receivedToolNames = Object.keys(options.tools ?? {});
      const stream = (async function* () {
        await options.onStepEnd?.({ content: [{ type: "text", text: "done" }], response: { messages: [] } } as never);
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      })();
      return { stream, totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }) };
    }) as unknown as typeof import("ai").streamText;

    await runAgent({
      sessionId: "session", runId: "run", userId: "user", capability: "isolated",
      promptVersion: "isolated-v1", model: "deepseek/deepseek-chat", systemPrompt: "isolated",
      capabilityConfig: null, maxSteps: 1, signal: new AbortController().signal,
      events: {
        async append(type, payload) {
          return { id: 1, sessionId: "session", runId: "run", sequence: 1, type, payload, createdAt: new Date(0) };
        },
      },
    }, {
      capabilities,
      provider,
      prepareContext: async () => ({
        events: [], messages: [{ role: "user", content: "start" }], estimatedTokens: 1,
        contextWindow: 2_000, maxOutputTokens: 100, compacted: false,
      }),
      stream: fakeStream,
    });

    assert.deepEqual(receivedToolNames, []);
  });

  test("closes a pre-output context overflow attempt and retries exactly once with the output bound", async () => {
    const events: AgentEvent[] = [];
    const triggers: Array<string | undefined> = [];
    const maxOutputs: Array<number | undefined> = [];
    let streamAttempt = 0;
    const prepared = (estimatedTokens: number, compacted: boolean): ContextLifecycleResult => ({
      events: [], messages: [{ role: "user", content: "continue" }], estimatedTokens,
      contextWindow: 2_000, maxOutputTokens: 300, compacted,
    });
    const provider: ProviderModel = {
      model: {} as LanguageModel,
      metadata: {
        provider: "deepseek", model: "deepseek/deepseek-chat", modelId: "deepseek-chat",
        structuredOutput: "json-object", thinking: "enabled", contextWindow: 2_000,
      },
    };
    const fakeStream = ((options: Parameters<typeof import("ai").streamText>[0]) => {
      streamAttempt += 1;
      maxOutputs.push(options.maxOutputTokens);
      const attempt = streamAttempt;
      const responseMessages: ModelMessage[] = [{ role: "assistant", content: "recovered" }];
      const stream = (async function* () {
        yield { type: "start-step" };
        if (attempt === 1) {
          yield { type: "error", error: new Error("maximum context length exceeded") };
          return;
        }
        await options.onStepEnd?.({
          content: [{ type: "text", text: "recovered" }],
          response: { messages: responseMessages },
        } as never);
        yield {
          type: "finish-step", finishReason: "stop",
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        };
      })();
      return { stream, totalUsage: Promise.resolve({ inputTokens: 2, outputTokens: 1, totalTokens: 3 }) };
    }) as unknown as typeof import("ai").streamText;

    const usage = await runAgent({
      sessionId: "session", runId: "run", model: "deepseek/deepseek-chat",
      userId: "user", capability: "workspace", promptVersion: "workspace-agent-v1",
      systemPrompt: "You are a read-only workspace agent.", capabilityConfig: { workspaceRoot: process.cwd() }, maxSteps: 1,
      signal: new AbortController().signal,
      events: {
        async append(type: AgentEventType, payload: Record<string, unknown>) {
          const event: AgentEvent = {
            id: events.length + 1, sessionId: "session", runId: "run", sequence: events.length + 1,
            type, payload, createdAt: new Date(0),
          };
          events.push(event);
          return event;
        },
      },
    }, {
      capabilities: builtInCapabilityRegistry,
      provider,
      prepareContext: async (input) => {
        triggers.push(input.trigger);
        return input.trigger === "context-overflow" ? prepared(50, true) : prepared(100, false);
      },
      stream: fakeStream,
    });

    assert.equal(streamAttempt, 2);
    assert.deepEqual(triggers, [undefined, "context-overflow"]);
    assert.deepEqual(maxOutputs, [300, 300]);
    assert.equal(events.filter((event) => event.type === "step_started").length, 2);
    assert.equal(events.filter((event) => event.type === "step_retried").length, 1);
    assert.equal(events.filter((event) => event.type === "step_completed").length, 1);
    assert.deepEqual(usage, { inputTokens: 2, outputTokens: 1, totalTokens: 3 });
  });
});
