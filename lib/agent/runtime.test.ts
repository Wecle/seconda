import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LanguageModel, ModelMessage } from "ai";
import type { ProviderModel } from "@/lib/ai/provider-registry";
import { runAgent } from "./runtime";
import type { ContextLifecycleResult } from "./context-lifecycle";
import type { AgentEvent, AgentEventType } from "./types";

describe("agent runtime", () => {
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
      systemPrompt: "You are a read-only workspace agent.", workspaceRoot: process.cwd(), maxSteps: 1,
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
