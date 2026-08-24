import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentEvent, AgentEventType } from "./types";
import { findOrphanedCompactionIds, prepareModelContext, type ContextLifecycleStore } from "./context-lifecycle";

function memoryStore(seed: Array<{ type: AgentEventType; payload: Record<string, unknown> }>) {
  let nextId = 1;
  const events: AgentEvent[] = seed.map((event, index) => ({
    id: nextId++, sessionId: "session", runId: null, sequence: index + 1,
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
});
