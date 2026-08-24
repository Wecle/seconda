import { stepCountIs, streamText, type LanguageModelUsage, type ModelMessage } from "ai";
import { createProviderModel } from "@/lib/ai/provider-registry";
import type { AgentEventSink, AgentRunInput } from "./types";
import { createWorkspaceToolRegistry } from "./workspace-tools";

function getQualityApiKey() {
  const key = process.env.QUALITY_MODEL_API_KEY?.trim();
  if (!key) throw new Error("QUALITY_MODEL_API_KEY must be configured");
  return key;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function usagePayload(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

async function appendModelMessages(events: AgentEventSink, messages: readonly ModelMessage[]) {
  for (const message of messages) {
    await events.append("model_message", { message: structuredClone(message) });
  }
}

export async function runAgent(input: AgentRunInput) {
  const provider = createProviderModel({
    model: input.model,
    credentialTier: "quality",
    apiKey: getQualityApiKey(),
    responseMode: "conversational",
  });
  const registry = createWorkspaceToolRegistry();
  const tools = registry.toAISDKTools({
    workspaceRoot: input.workspaceRoot,
    signal: input.signal,
  });

  await input.events.append("run_started", {
    model: input.model,
    maxSteps: input.maxSteps,
    tools: registry.schemas().map(({ name, description }) => ({ name, description })),
  });

  let nextBlockIndex = 0;
  const blockIndexes = new Map<string, number>();
  let pendingDelta:
    | { type: "text-delta" | "reasoning-delta"; index: number; text: string }
    | undefined;
  const completedStepMessages: ModelMessage[][] = [];
  const stepMessageWaiters: Array<(messages: ModelMessage[]) => void> = [];
  const publishStepMessages = (messages: ModelMessage[]) => {
    const waiter = stepMessageWaiters.shift();
    if (waiter) waiter(messages);
    else completedStepMessages.push(messages);
  };
  const takeStepMessages = () => {
    const messages = completedStepMessages.shift();
    return messages ? Promise.resolve(messages) : new Promise<ModelMessage[]>((resolve) => {
      stepMessageWaiters.push(resolve);
    });
  };
  const flushDelta = async () => {
    if (!pendingDelta) return;
    const chunk = pendingDelta;
    pendingDelta = undefined;
    await input.events.append("assistant_chunk", { chunk });
  };
  const blockIndex = (id: string) => {
    const existing = blockIndexes.get(id);
    if (existing !== undefined) return existing;
    const index = nextBlockIndex++;
    blockIndexes.set(id, index);
    return index;
  };
  const appendDelta = async (
    type: "text-delta" | "reasoning-delta",
    id: string,
    text: string,
  ) => {
    const index = blockIndex(id);
    if (pendingDelta && (pendingDelta.type !== type || pendingDelta.index !== index)) {
      await flushDelta();
    }
    pendingDelta ??= { type, index, text: "" };
    pendingDelta.text += text;
    if (pendingDelta.text.length >= 256) await flushDelta();
  };
  const result = streamText({
    model: provider.model,
    system: input.systemPrompt,
    messages: input.messages,
    tools,
    toolOrder: ["list_files", "search_files", "read_file"],
    stopWhen: stepCountIs(input.maxSteps),
    abortSignal: input.signal,
    maxRetries: 0,
    onStepEnd: (step) => {
      publishStepMessages(structuredClone(step.response.messages as ModelMessage[]));
    },
  });

  let totalUsage: LanguageModelUsage | undefined;
  for await (const part of result.stream) {
    if (part.type !== "text-delta" && part.type !== "reasoning-delta") await flushDelta();
    switch (part.type) {
      case "start-step":
        blockIndexes.clear();
        nextBlockIndex = 0;
        await input.events.append("step_started", {});
        break;
      case "text-start":
        await input.events.append("assistant_chunk", {
          chunk: { type: "block-start", index: blockIndex(part.id), blockType: "text" },
        });
        break;
      case "text-delta":
        await appendDelta("text-delta", part.id, part.text);
        break;
      case "text-end":
        await input.events.append("assistant_chunk", {
          chunk: { type: "block-end", index: blockIndex(part.id), blockType: "text" },
        });
        break;
      case "reasoning-start":
        await input.events.append("assistant_chunk", {
          chunk: { type: "block-start", index: blockIndex(part.id), blockType: "reasoning" },
        });
        break;
      case "reasoning-delta":
        await appendDelta("reasoning-delta", part.id, part.text);
        break;
      case "reasoning-end":
        await input.events.append("assistant_chunk", {
          chunk: { type: "block-end", index: blockIndex(part.id), blockType: "reasoning" },
        });
        break;
      case "tool-call":
        await input.events.append("tool_called", {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        break;
      case "tool-result":
        await input.events.append("tool_completed", {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        });
        break;
      case "tool-error":
        await input.events.append("tool_completed", {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          error: part.error instanceof Error ? part.error.message : "Tool execution failed",
        });
        break;
      case "finish-step":
        await input.events.append("step_completed", {
          finishReason: part.finishReason,
          usage: usagePayload(part.usage),
        });
        await appendModelMessages(input.events, await takeStepMessages());
        break;
      case "finish":
        totalUsage = part.totalUsage;
        break;
      case "error":
        throw part.error;
      case "abort":
        throw input.signal.reason ?? new DOMException(part.reason ?? "Aborted", "AbortError");
      default:
        break;
    }
  }

  await flushDelta();
  const usage = totalUsage ?? await result.totalUsage;
  return usagePayload(usage);
}

export function safeAgentError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "Agent run was cancelled";
  if (error instanceof DOMException && error.name === "TimeoutError") return "Agent run exceeded its time limit";
  if (error instanceof Error) {
    if (error.message.includes("must be configured")) return error.message;
    if (error.name === "RepeatedToolCallError") return error.message;
  }
  return "Agent run failed. Check the model configuration and try again.";
}

export function modelMessageText(message: ModelMessage) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part) => {
      const record = asRecord(part);
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
}
