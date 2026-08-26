import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ModelMessage } from "ai";
import type { AgentEvent, AgentEventType } from "./types";
import { findOrphanedCompactionIds, prepareModelContext, type ContextLifecycleStore } from "./context-lifecycle";

function memoryStore(seed: Array<{ type: AgentEventType; payload: Record<string, unknown>; runId?: string | null }>) {
  let nextId = 1;
  const events: AgentEvent[] = seed.map((event, index) => ({
    id: nextId++, sessionId: "session", runId: event.runId ?? null, sequence: index + 1,
    type: event.type, payload: structuredClone(event.payload),
    dedupeKey: null, schemaVersion: 1, visibility: "model", createdAt: new Date(0),
  }));
  const makeEvent = (type: AgentEventType, payload: Record<string, unknown>, runId: string | null) => {
    const event: AgentEvent = {
      id: nextId++, sessionId: "session", runId, sequence: events.length + 1,
      type, payload: structuredClone(payload),
      dedupeKey: null, schemaVersion: 1, visibility: "model", createdAt: new Date(0),
    };
    events.push(event);
    return event;
  };
  const store: ContextLifecycleStore = {
    async load() { return structuredClone(events); },
    async append(input) { return makeEvent(input.type, input.payload, input.runId); },
    async appendAtomic(input) {
      return input.events.map((event) => makeEvent(event.type, event.payload, input.runId));
    },
  };
  return { store, events };
}

function longConversation(count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    type: (index % 2 === 0 ? "user_message" : "assistant_message") as AgentEventType,
    payload: { message: { role: index % 2 === 0 ? "user" : "assistant", content: `${index}:${"x".repeat(600)}` } },
  }));
}

describe("context lifecycle", () => {
  test("commits summary, replacement, and completion atomically before projecting", async () => {
    const memory = memoryStore(longConversation());
    const result = await prepareModelContext({
      sessionId: "session", runId: "run", model: "test", contextWindow: 2_000,
      system: "system", toolSchemas: [], signal: new AbortController().signal,
      store: memory.store, summarize: async () => ({ text: "Preserve the original goal and verified facts." }),
    });
    assert.equal(result.compacted, true);
    assert.ok(result.estimatedTokens < 1_700);
    assert.ok(result.messages.some((message) => typeof message.content === "string" && message.content.includes("<compacted-context>")));
    const types = memory.events.map((event) => event.type);
    assert.deepEqual(types.slice(-4), ["compaction_started", "compaction_summary", "model_context_replaced", "compaction_completed"]);
  });

  test("summary failure leaves the original model history intact", async () => {
    const memory = memoryStore(longConversation());
    await assert.rejects(prepareModelContext({
      sessionId: "session", runId: "run", model: "test", contextWindow: 2_000,
      system: "system", toolSchemas: [], signal: new AbortController().signal,
      store: memory.store, summarize: async () => { throw new Error("summary unavailable"); },
    }), /summary unavailable/);
    assert.equal(memory.events.filter((event) => event.type === "model_context_replaced").length, 0);
    assert.equal(memory.events.at(-1)?.type, "compaction_failed");
    assert.equal(memory.events.filter((event) => event.type === "user_message" || event.type === "assistant_message").length, 12);
  });

  test("rejects an oversized summary before committing a replacement", async () => {
    const memory = memoryStore(longConversation());
    await assert.rejects(prepareModelContext({
      sessionId: "session", runId: "run", model: "test", contextWindow: 2_000,
      system: "system", toolSchemas: [], signal: new AbortController().signal,
      store: memory.store, summarize: async () => ({ text: "s".repeat(12_000) }),
    }), /did not reduce/);
    assert.equal(memory.events.filter((event) => event.type === "model_context_replaced").length, 0);
    assert.equal(memory.events.at(-1)?.type, "compaction_failed");
  });

  test("does not commit a growing summary even while the candidate remains below the hard cap", async () => {
    const memory = memoryStore(longConversation(10));
    const result = await prepareModelContext({
      sessionId: "session", runId: "run", model: "test", contextWindow: 2_000,
      system: "system", toolSchemas: [], signal: new AbortController().signal,
      store: memory.store, summarize: async () => ({ text: "s".repeat(2_400) }),
    });
    assert.equal(result.compacted, false);
    assert.equal(memory.events.filter((event) => event.type === "model_context_replaced").length, 0);
    assert.equal(memory.events.at(-1)?.type, "compaction_failed");
  });

  test("closes interrupted compaction attempts during recovery", async () => {
    const memory = memoryStore([
      { type: "user_message", payload: { message: { role: "user", content: "hello" } } },
      { type: "compaction_started", payload: { compactionId: "orphan" } },
    ]);
    assert.deepEqual(findOrphanedCompactionIds(memory.events), ["orphan"]);
    await prepareModelContext({
      sessionId: "session", runId: "run", model: "test", contextWindow: 10_000,
      system: "system", toolSchemas: [], signal: new AbortController().signal, store: memory.store,
    });
    assert.deepEqual(findOrphanedCompactionIds(memory.events), []);
    assert.equal(memory.events[2].type, "compaction_failed");
    assert.equal(memory.events[2].payload.recovered, true);
  });

  test("retry context excludes the failed attempt while preserving prior history and the current attempt", async () => {
    const failedAssistant = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "failed-call", toolName: "read", input: {} }],
    } as ModelMessage;
    const failedTool = {
      role: "tool",
      content: [{
        type: "tool-result", toolCallId: "failed-call", toolName: "read",
        output: { type: "json", value: { leaked: true } },
      }],
    } as ModelMessage;
    const memory = memoryStore([
      { type: "user_message", runId: "prior", payload: { message: { role: "user", content: "completed history" } } },
      { type: "model_message", runId: "failed-attempt", payload: { message: { role: "user", content: "logical trigger" } } },
      { type: "assistant_message", runId: "failed-attempt", payload: { message: failedAssistant } },
      { type: "tool_result_message", runId: "failed-attempt", payload: { message: failedTool } },
      { type: "assistant_message", runId: "retry-attempt", payload: { message: { role: "assistant", content: "current progress" } } },
    ]);

    const result = await prepareModelContext({
      sessionId: "session", runId: "retry-attempt", model: "test", contextWindow: 10_000,
      system: "system", toolSchemas: [], signal: new AbortController().signal,
      store: memory.store, modelContextBoundarySequence: 2,
    });

    assert.deepEqual(result.messages, [
      { role: "user", content: "completed history" },
      { role: "user", content: "logical trigger" },
      { role: "assistant", content: "current progress" },
    ]);
    assert.doesNotMatch(JSON.stringify(result.messages), /failed-call|leaked/);
  });

  test("replays compaction and reduces context cleanly even with old consumed skill pairs in history", async () => {
    const oldSkillCall = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "skill-1", toolName: "skill", input: { name: "resume-deep-dive" } }],
    } as ModelMessage;
    const oldSkillResult = {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "skill-1",
        toolName: "skill",
        output: { type: "json", value: { instructions: "private skill instructions" } },
      }],
    } as ModelMessage;

    const seed: Array<{ type: AgentEventType; payload: Record<string, unknown>; runId?: string | null }> = [
      { runId: "old-run", type: "user_message", payload: { message: { role: "user", content: `Q1:${"a".repeat(600)}` } } },
      { runId: "old-run", type: "assistant_message", payload: { message: oldSkillCall } },
      { runId: "old-run", type: "tool_result_message", payload: { message: oldSkillResult } },
      { runId: "old-run", type: "assistant_message", payload: { message: { role: "assistant", content: `A1:${"b".repeat(600)}` } } },
      { runId: "old-run", type: "user_message", payload: { message: { role: "user", content: `Q2:${"c".repeat(600)}` } } },
      { runId: "old-run", type: "assistant_message", payload: { message: { role: "assistant", content: `A2:${"d".repeat(600)}` } } },
      { runId: "old-run", type: "user_message", payload: { message: { role: "user", content: `Q3:${"e".repeat(600)}` } } },
      { runId: "old-run", type: "assistant_message", payload: { message: { role: "assistant", content: `A3:${"f".repeat(600)}` } } },
      { runId: "old-run", type: "user_message", payload: { message: { role: "user", content: `Q4:${"g".repeat(600)}` } } },
      { runId: "old-run", type: "assistant_message", payload: { message: { role: "assistant", content: `A4:${"h".repeat(600)}` } } },
      { runId: "current-run", type: "user_message", payload: { message: { role: "user", content: `Q5:${"i".repeat(600)}` } } },
    ];

    const memory = memoryStore(seed);
    const result = await prepareModelContext({
      sessionId: "session",
      runId: "current-run",
      model: "deepseek/deepseek-v4-flash",
      contextWindow: 1_048_576,
      operationalBudget: 1_500,
      system: "system prompt",
      toolSchemas: [],
      signal: new AbortController().signal,
      store: memory.store,
      summarize: async () => ({ text: "Summary of Q1-Q4 interactions." }),
    });

    assert.equal(result.compacted, true);
    assert.ok(result.messages.some((m) => typeof m.content === "string" && m.content.includes("Summary of Q1-Q4")));
    assert.ok(result.estimatedTokens < 1_500);
  });

  test("throws when committed compaction replacement is rejected by model input projection", async () => {
    const memory = memoryStore(longConversation());
    // Store that tampers with the replacement event by corrupting shadowedSequences so projection rejects it
    const corruptingStore: ContextLifecycleStore = {
      async load() { return memory.store.load("session"); },
      async append(input) { return memory.store.append(input); },
      async appendAtomic(input) {
        const corruptedEvents = input.events.map((e) => {
          if (e.type === "model_context_replaced") {
            return {
              ...e,
              payload: { ...e.payload, shadowedSequences: [99999] }, // Non-existent sequence!
            };
          }
          return e;
        });
        return memory.store.appendAtomic({ ...input, events: corruptedEvents });
      },
    };

    await assert.rejects(
      prepareModelContext({
        sessionId: "session",
        runId: "run",
        model: "test",
        contextWindow: 2_000,
        system: "system",
        toolSchemas: [],
        signal: new AbortController().signal,
        store: corruptingStore,
        summarize: async () => ({ text: "Valid summary text." }),
      }),
      /COMPACTION_REPLACEMENT_REJECTED/,
    );
  });
});
