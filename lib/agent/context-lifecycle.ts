import { generateText, type ModelMessage } from "ai";
import { createProviderModel } from "@/lib/ai/provider-registry";
import { compactionSummaryMessage, COMPACTION_SYSTEM_PROMPT, renderCompactionTranscript, selectCompactionRegion } from "./compaction";
import { contextPressure, cropToolResultMessage, measureRequestTokens, resolveContextWindow } from "./context-budget";
import { projectModelInput } from "./model-input";
import type { AgentEvent, AgentEventSink, AgentEventType } from "./types";

export type ContextLifecycleResult = {
  events: AgentEvent[];
  messages: ModelMessage[];
  estimatedTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  compacted: boolean;
};

export type ContextLifecycleStore = {
  load(sessionId: string): Promise<AgentEvent[]>;
  append(input: { sessionId: string; runId: string; type: AgentEventType; payload: Record<string, unknown> }): Promise<AgentEvent>;
  appendAtomic(input: {
    sessionId: string;
    runId: string;
    events: Array<{ type: AgentEventType; payload: Record<string, unknown> }>;
  }): Promise<AgentEvent[]>;
};

export type PrepareContextInput = {
  sessionId: string;
  runId: string;
  model: string;
  contextWindow?: number;
  system: string;
  toolSchemas: unknown;
  signal: AbortSignal;
  liveEvents?: AgentEventSink;
  publish?: (event: AgentEvent) => void;
  summarize?: (messages: readonly ModelMessage[], signal: AbortSignal) => Promise<{ text: string; usage?: Record<string, unknown> }>;
  store?: ContextLifecycleStore;
  trigger?: "pressure" | "context-overflow";
  compactionDepth?: number;
};

const defaultStore: ContextLifecycleStore = {
  async load(sessionId) {
    return (await import("./repository")).loadAgentEvents(sessionId);
  },
  async append(input) {
    return (await import("./repository")).appendAgentEvent(input);
  },
  async appendAtomic(input) {
    return (await import("./repository")).appendAgentEventsAtomically(input);
  },
};

function apiKey() {
  const key = process.env.QUALITY_MODEL_API_KEY?.trim();
  if (!key) throw new Error("QUALITY_MODEL_API_KEY must be configured");
  return key;
}

async function defaultSummarize(model: string, messages: readonly ModelMessage[], signal: AbortSignal) {
  const provider = createProviderModel({
    model,
    credentialTier: "quality",
    apiKey: apiKey(),
    responseMode: "conversational",
  });
  const result = await generateText({
    model: provider.model,
    system: COMPACTION_SYSTEM_PROMPT,
    prompt: renderCompactionTranscript(messages),
    abortSignal: signal,
    maxRetries: 0,
    maxOutputTokens: 2_048,
  });
  return {
    text: result.text,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    },
  };
}

async function emit(input: PrepareContextInput, type: Parameters<AgentEventSink["append"]>[0], payload: Record<string, unknown>) {
  if (input.liveEvents) return input.liveEvents.append(type, payload);
  return (input.store ?? defaultStore).append({ sessionId: input.sessionId, runId: input.runId, type, payload });
}

export function findOrphanedCompactionIds(events: readonly AgentEvent[]) {
  const open = new Set<string>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const id = event.payload.compactionId;
    if (typeof id !== "string") continue;
    if (event.type === "compaction_started") open.add(id);
    if (event.type === "compaction_completed" || event.type === "compaction_failed") open.delete(id);
  }
  return [...open];
}

async function recoverOrphanedCompactions(input: PrepareContextInput, events: AgentEvent[]) {
  for (const compactionId of findOrphanedCompactionIds(events)) {
    const recovered = await emit(input, "compaction_failed", {
      compactionId,
      message: "Recovered an interrupted context compaction",
      recovered: true,
    });
    events.push(recovered);
  }
}

async function spillLargeToolResults(input: PrepareContextInput, events: AgentEvent[]) {
  const projection = projectModelInput(events, { activeRunId: input.runId });
  const replacements: Array<{ originalSequence: number; message: ModelMessage }> = [];
  projection.messages.forEach((message, index) => {
    const cropped = cropToolResultMessage(message);
    if (cropped) replacements.push({ originalSequence: projection.surfaceSequences[index], message: cropped });
  });
  for (const replacement of replacements) {
    const event = await emit(input, "tool_result_spilled", {
      shadowedSequences: [replacement.originalSequence],
      message: replacement.message,
      strategy: "unicode-head-tail",
    });
    events.push(event);
  }
  return replacements.length;
}

export async function prepareModelContext(input: PrepareContextInput): Promise<ContextLifecycleResult> {
  const store = input.store ?? defaultStore;
  const contextWindow = input.contextWindow ?? resolveContextWindow(input.model);
  let events = await store.load(input.sessionId);
  await recoverOrphanedCompactions(input, events);
  const spillCount = await spillLargeToolResults(input, events);
  if (spillCount > 0) events = await store.load(input.sessionId);

  let projection = projectModelInput(events, { activeRunId: input.runId });
  let estimatedTokens = measureRequestTokens(input.system, projection.messages, input.toolSchemas);
  const pressure = contextPressure({ estimatedTokens, contextWindow });
  await emit(input, "request_context", {
    model: input.model,
    contextWindow,
    estimatedTokens,
    reserveTokens: pressure.reserveTokens,
    systemTokensIncluded: true,
    toolSchemasIncluded: true,
  });
  const trigger = input.trigger ?? "pressure";
  if (!pressure.pressured && trigger !== "context-overflow") {
    return { events, messages: projection.messages, estimatedTokens, contextWindow, maxOutputTokens: pressure.reserveTokens, compacted: false };
  }

  await emit(input, "context_pressure", {
    estimatedTokens,
    contextWindow,
    ratio: pressure.ratio,
    spillCount,
    trigger,
  });
  const region = selectCompactionRegion(projection, contextWindow);
  if (!region) {
    if (estimatedTokens >= pressure.usableTokens) {
      throw new Error("Context exceeds the model window and has no safe compaction region");
    }
    return { events, messages: projection.messages, estimatedTokens, contextWindow, maxOutputTokens: pressure.reserveTokens, compacted: false };
  }

  const compactionId = crypto.randomUUID();
  const beforeCompactionTokens = estimatedTokens;
  await emit(input, "compaction_started", {
    compactionId,
    trigger,
    shadowedSequences: region.shadowedSequences,
    shadowedTokenCount: region.estimatedTokens,
  });
  let committed: AgentEvent[];
  try {
    input.signal.throwIfAborted();
    const summarized = await (input.summarize ?? ((messages, signal) => defaultSummarize(input.model, messages, signal)))(region.messages, input.signal);
    if (!summarized.text.trim()) throw new Error("Compaction returned an empty summary");
    input.signal.throwIfAborted();
    const message = compactionSummaryMessage(summarized.text);
    const candidateMessages = [message, ...projection.messages.slice(region.messages.length)];
    const candidateTokens = measureRequestTokens(input.system, candidateMessages, input.toolSchemas);
    if (candidateTokens >= beforeCompactionTokens) {
      throw new Error("Compaction summary did not reduce the model context");
    }
    committed = await store.appendAtomic({
      sessionId: input.sessionId,
      runId: input.runId,
      events: [
        { type: "compaction_summary", payload: { compactionId, summary: summarized.text, usage: summarized.usage ?? null, model: input.model } },
        { type: "model_context_replaced", payload: { compactionId, shadowedSequences: region.shadowedSequences, message } },
        { type: "compaction_completed", payload: { compactionId, shadowedTokenCount: region.estimatedTokens } },
      ],
    });
  } catch (error) {
    await emit(input, "compaction_failed", {
      compactionId,
      message: input.signal.aborted ? "Context compaction was cancelled" : "Context compaction failed",
    });
    if (input.signal.aborted || estimatedTokens >= pressure.usableTokens) throw error;
    return { events, messages: projection.messages, estimatedTokens, contextWindow, maxOutputTokens: pressure.reserveTokens, compacted: false };
  }
  for (const event of committed) input.publish?.(event);
  events = await store.load(input.sessionId);
  projection = projectModelInput(events, { activeRunId: input.runId });
  estimatedTokens = measureRequestTokens(input.system, projection.messages, input.toolSchemas);
  const afterPressure = contextPressure({ estimatedTokens, contextWindow });
  if (estimatedTokens >= afterPressure.usableTokens) {
    const depth = input.compactionDepth ?? 0;
    if (depth < 1 && estimatedTokens < beforeCompactionTokens) {
      return prepareModelContext({ ...input, trigger: "context-overflow", compactionDepth: depth + 1 });
    }
    throw new Error("Context remains over the usable model window after compaction");
  }
  return { events, messages: projection.messages, estimatedTokens, contextWindow, maxOutputTokens: afterPressure.reserveTokens, compacted: true };
}
