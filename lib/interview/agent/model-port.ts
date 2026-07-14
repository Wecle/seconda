import { randomUUID } from "node:crypto";

import { parsePartialJson, streamText, tool } from "ai";

import { classifyModelError } from "@/lib/ai/model-errors";
import {
  loadModelPolicy,
  resolveModelCandidates,
  type ModelCandidate,
} from "@/lib/ai/model-policy";
import { createProviderModel } from "@/lib/ai/provider-registry";

import { runAgentAttempts } from "./attempt-controller";
import type { AgentModelStep } from "./contracts";
import { normalizeModelUsage, type NormalizedModelUsage } from "./context/telemetry";
import {
  createAgentProviderStepSchema,
  interviewToolInputSchemas,
  interviewToolNames,
  type InterviewToolName,
} from "./tool-registry";

export type AgentRuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type AgentToolDescriptor = {
  name: string;
  description: string;
};

export type AgentModelStreamEvent =
  | {
    type: "public_reasoning_delta";
    attemptId: string;
    text: string;
  }
  | {
    type: "tool_input_delta";
    attemptId: string;
    toolCallId: string;
    toolName: string;
    inputText: string;
    partialInput: unknown;
  };

type NextStepInput = {
  runId: string;
  attemptNumberOffset?: number;
  messages: readonly AgentRuntimeMessage[];
  tools: readonly AgentToolDescriptor[];
  signal: AbortSignal;
  promptContext?: {
    stablePrefix: string;
    incrementalTail: string;
  };
};

export interface InterviewAgentModelPort {
  nextStep(input: NextStepInput): Promise<AgentModelStep>;
  nextStepStream?(input: NextStepInput & {
    onAttemptStarted?: (attempt: {
      model: string;
      attemptId: string;
      attemptNumber: number;
      provisionalMessageId: string;
    }) => Promise<void>;
    onProviderProgress: () => Promise<void>;
    onStreamEvent: (event: AgentModelStreamEvent) => Promise<boolean>;
  }): Promise<{
    step: AgentModelStep;
    attemptId: string;
    provisionalMessageId: string | null;
  }>;
}

type CandidateStream = {
  fullStream: AsyncIterable<unknown>;
  usage?: PromiseLike<unknown>;
};

export function createStreamingInterviewAgentModelPort(options: {
  candidates: readonly { model: string }[];
  classifyError: (error: unknown) => "transient" | "fatal";
  streamCandidate: (input: {
    model: string;
    runId: string;
    messages: readonly AgentRuntimeMessage[];
    tools: readonly AgentToolDescriptor[];
    signal: AbortSignal;
  }) => Promise<CandidateStream>;
  onAttemptStarted: (input: {
    model: string;
    attemptId: string;
    attemptNumber: number;
    provisionalMessageId: string;
  }) => Promise<void>;
  idleTimeoutMs?: number;
  createAttemptId?: (model: string, attemptNumber: number) => string;
  createMessageId?: () => string;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  onUsage?: (input: { runId: string; usage: NormalizedModelUsage }) => Promise<void>;
}): InterviewAgentModelPort {
  const port: InterviewAgentModelPort = {
    async nextStep(input) {
      const result = await port.nextStepStream!({
        ...input,
        onProviderProgress: async () => {},
        onStreamEvent: async () => false,
      });
      return result.step;
    },
    async nextStepStream(input) {
      const providerSchema = createAgentProviderStepSchema(activeToolNames(input.tools));
      const messageIds = new Map<string, string>();
      const result = await runAgentAttempts({
        candidates: options.candidates,
        classifyError: options.classifyError,
        signal: input.signal,
        sleep: options.sleep,
        random: options.random,
        createId: options.createAttemptId,
        attemptNumberOffset: input.attemptNumberOffset,
        onAttemptStarted: async (attempt) => {
          const messageId = options.createMessageId?.() ?? randomUUID();
          messageIds.set(attempt.attemptId, messageId);
          const startedAttempt = {
            ...attempt,
            provisionalMessageId: messageId,
          };
          await options.onAttemptStarted(startedAttempt);
          await input.onAttemptStarted?.(startedAttempt);
        },
        attempt: async ({ model, attemptId, acceptProvisional }) => {
          const attemptController = new AbortController();
          const combined = combineAbortSignals([input.signal, attemptController.signal]);
          let iterator: AsyncIterator<unknown> | undefined;
          try {
            const stream = await withAbortSignal(options.streamCandidate({
              model,
              runId: input.runId,
              messages: input.messages,
              tools: input.tools,
              signal: combined.signal,
            }), combined.signal);
            const activeToolNames = new Set(input.tools.map((descriptor) => descriptor.name));
            let startedTool: {
              id: string;
              name: string;
              ended: boolean;
            } | null = null;
            const toolNames = new Map<string, string>();
            const toolInputTexts = new Map<string, string>();
            let finalToolCall: AgentModelStep | null = null;
            iterator = stream.fullStream[Symbol.asyncIterator]();

            while (true) {
              const next = await withIdleTimeout(
                iterator.next(),
                options.idleTimeoutMs ?? 25_000,
                combined.signal,
                (error) => attemptController.abort(error),
              );
              if (next.done) break;
              await input.onProviderProgress();
              const part = asStreamPart(next.value);
              if (!part) continue;

              if (part.type === "error") {
                throw (part as { error?: unknown }).error ?? new Error("Provider stream failed");
              }
              if (part.type === "abort") {
                const reason = (part as { reason?: unknown }).reason;
                throw Object.assign(new Error(
                  typeof reason === "string" ? reason : "Provider stream aborted",
                ), {
                  code: "PROVIDER_STREAM_ABORTED",
                });
              }
              if (part.type === "reasoning-delta") continue;

              if (part.type === "text-delta") {
                if (finalToolCall) throw protocolError("Text arrived after the final tool call");
                if (startedTool) throw protocolError("Text arrived after tool input started");
                const text = (part as { text?: unknown }).text;
                if (typeof text !== "string" || !text) continue;
                await publishStreamEvent(input.onStreamEvent, {
                  type: "public_reasoning_delta",
                  attemptId,
                  text,
                }, acceptProvisional);
                continue;
              }

              if (part.type === "tool-input-start") {
                const { id, toolName } = part as { id?: unknown; toolName?: unknown };
                if (finalToolCall) throw protocolError("Tool input started after the final tool call");
                if (typeof id !== "string" || !id || typeof toolName !== "string" || !toolName) {
                  throw protocolError("Tool input start is malformed");
                }
                if (!activeToolNames.has(toolName)) {
                  throw protocolError(`Tool input started for inactive tool: ${toolName}`, {
                    kind: "inactive_tool",
                    toolName,
                  });
                }
                if (startedTool) throw protocolError("Multiple tool input streams are not allowed");
                startedTool = { id, name: toolName, ended: false };
                toolNames.set(id, toolName);
                toolInputTexts.set(id, "");
                continue;
              }

              if (part.type === "tool-input-delta") {
                const { id, delta } = part as { id?: unknown; delta?: unknown };
                if (finalToolCall) throw protocolError("Tool input arrived after the final tool call");
                if (typeof id !== "string" || typeof delta !== "string") {
                  throw protocolError("Tool input delta is malformed");
                }
                if (!startedTool || id !== startedTool.id) {
                  throw protocolError("Tool input delta does not match its start event");
                }
                if (startedTool.ended) throw protocolError("Tool input arrived after its end event");
                const toolName = toolNames.get(id)!;
                const inputText = `${toolInputTexts.get(id) ?? ""}${delta}`;
                toolInputTexts.set(id, inputText);
                const partial = await parsePartialJson(inputText);
                await publishStreamEvent(input.onStreamEvent, {
                  type: "tool_input_delta",
                  attemptId,
                  toolCallId: id,
                  toolName,
                  inputText,
                  partialInput: partial.value,
                }, acceptProvisional);
                continue;
              }

              if (part.type === "tool-input-end") {
                const { id } = part as { id?: unknown };
                if (finalToolCall) throw protocolError("Tool input ended after the final tool call");
                if (typeof id !== "string" || !startedTool || id !== startedTool.id) {
                  throw protocolError("Tool input end does not match its start event");
                }
                if (startedTool.ended) throw protocolError("Tool input ended more than once");
                startedTool.ended = true;
                continue;
              }

              if (part.type === "tool-call") {
                const toolCall = part as {
                  toolCallId?: unknown;
                  toolName?: unknown;
                  input?: unknown;
                };
                if (finalToolCall) throw protocolError("Multiple final tool calls are not allowed");
                if (
                  typeof toolCall.toolCallId !== "string" ||
                  !toolCall.toolCallId ||
                  typeof toolCall.toolName !== "string" ||
                  !toolCall.toolName
                ) {
                  throw protocolError("Final tool call is malformed");
                }
                if (!activeToolNames.has(toolCall.toolName)) {
                  throw protocolError(`Final call used inactive tool: ${toolCall.toolName}`, {
                    kind: "inactive_tool",
                    toolName: toolCall.toolName,
                  });
                }
                if (startedTool && (
                  toolCall.toolCallId !== startedTool.id ||
                  toolCall.toolName !== startedTool.name
                )) {
                  throw protocolError("Final tool call does not match its input stream");
                }
                try {
                  finalToolCall = providerSchema.parse({
                    type: "tool_call",
                    callId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    args: toolCall.input,
                  });
                } catch (cause) {
                  throw modelActionError(toolCall.toolName, cause);
                }
              }
            }

            if (!finalToolCall) {
              throw Object.assign(new Error("Provider did not produce a tool call"), {
                code: "MODEL_TOOL_CALL_REQUIRED",
              });
            }
            if (stream.usage) {
              await options.onUsage?.({
                runId: input.runId,
                usage: normalizeModelUsage(await Promise.resolve(stream.usage)),
              });
            }
            return finalToolCall;
          } catch (error) {
            if (!attemptController.signal.aborted) attemptController.abort(error);
            closeIterator(iterator);
            throw error;
          } finally {
            combined.dispose();
          }
        },
      });
      const provisionalMessageId = messageIds.get(result.attemptId);
      if (!provisionalMessageId) throw new Error("Agent attempt message id is missing");
      return {
        step: result.value,
        attemptId: result.attemptId,
        provisionalMessageId,
      };
    },
  };
  return port;
}

export function createStructuredInterviewAgentModelPort(options?: {
  onUsage?: (input: { runId: string; usage: NormalizedModelUsage }) => Promise<void>;
  fetch?: typeof globalThis.fetch;
}): InterviewAgentModelPort {
  const policy = loadModelPolicy(process.env);
  const { candidates } = resolveModelCandidates("interview.agent", policy);
  return createStreamingInterviewAgentModelPort({
    candidates,
    idleTimeoutMs: readPositiveInteger(
      process.env.INTERVIEW_AGENT_PROVIDER_IDLE_MS,
      25_000,
    ),
    classifyError: classifyInterviewAgentModelError,
    async onAttemptStarted() {},
    onUsage: options?.onUsage,
    async streamCandidate(input) {
      const candidate = candidates.find((item) => item.model === input.model);
      if (!candidate) throw new Error(`Unknown Agent model candidate: ${input.model}`);
      return createProviderAgentStream(candidate, input, options?.fetch);
    },
  });
}

export function classifyInterviewAgentModelError(error: unknown) {
  if (readErrorCode(error) === "PROVIDER_IDLE_TIMEOUT") return "transient" as const;
  return classifyModelError(error) === "fatal" ? "fatal" as const : "transient" as const;
}

function createProviderAgentStream(
  candidate: ModelCandidate,
  input: {
    model: string;
    runId: string;
    messages: readonly AgentRuntimeMessage[];
    tools: readonly AgentToolDescriptor[];
    signal: AbortSignal;
  },
  providerFetch?: typeof globalThis.fetch,
) {
  const keyName = candidate.credentialTier === "fast"
    ? "FAST_MODEL_API_KEY"
    : "QUALITY_MODEL_API_KEY";
  const apiKey = process.env[keyName]?.trim();
  if (!apiKey) throw new Error(`${keyName} must be configured`);
  const provider = createProviderModel({
    ...candidate,
    apiKey,
    responseMode: "conversational",
    fetch: providerFetch,
  });
  const result = streamText({
    model: provider.model,
    system: AGENT_SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    tools: createProviderToolSet(input.tools),
    toolChoice: "required",
    abortSignal: input.signal,
    maxRetries: 0,
  });
  return {
    fullStream: result.fullStream,
    usage: result.usage,
  };
}

export function createProviderToolSet(tools: readonly AgentToolDescriptor[]) {
  const names = activeToolNames(tools);
  return Object.fromEntries(names.map((name, index) => [
    name,
    createProviderTool(tools[index].description, interviewToolInputSchemas[name]),
  ]));
}

function createProviderTool(
  description: string,
  inputSchema: (typeof interviewToolInputSchemas)[InterviewToolName],
) {
  return tool<unknown, Record<string, unknown>>({ description, inputSchema });
}

async function publishStreamEvent(
  callback: (event: AgentModelStreamEvent) => Promise<boolean>,
  event: AgentModelStreamEvent,
  acceptProvisional: () => void,
) {
  if (await callback(event)) acceptProvisional();
}

function protocolError(
  message: string,
  protocol: {
    kind: "inactive_tool";
    toolName: string;
  } | {
    kind: "malformed_stream";
  } = { kind: "malformed_stream" },
) {
  return Object.assign(new Error(message), {
    code: "MODEL_STREAM_PROTOCOL_ERROR",
    protocol,
  });
}

function modelActionError(toolName: string, cause: unknown) {
  return Object.assign(
    new Error("Model tool-call arguments failed schema validation", { cause }),
    {
      code: "MODEL_TOOL_ACTION_INVALID",
      modelAction: {
        kind: "malformed_tool_arguments",
        toolName,
      },
    },
  );
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function combineAbortSignals(signals: readonly AbortSignal[]) {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    listeners.push(() => signal.removeEventListener("abort", onAbort));
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const remove of listeners) remove();
    },
  };
}

function withAbortSignal<T>(promise: PromiseLike<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    let settled = false;
    const onAbort = () => settle(() => reject(abortReason(signal)));
    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      complete();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

function closeIterator(iterator: AsyncIterator<unknown> | undefined) {
  if (!iterator?.return) return;
  try {
    void Promise.resolve(iterator.return()).catch(() => {});
  } catch {}
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function asStreamPart(value: unknown): null | {
  type: string;
  [key: string]: unknown;
} {
  return value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
    ? value as { type: string; [key: string]: unknown }
    : null;
}

function withIdleTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  signal: AbortSignal,
  onTimeout: (error: Error & { code: string }) => void,
) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    let settled = false;
    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = () => settle(() => reject(abortReason(signal)));
    const timeout = setTimeout(() => {
      const error = Object.assign(new Error("Provider stream made no progress"), {
        code: "PROVIDER_IDLE_TIMEOUT",
      });
      onTimeout(error);
      settle(() => reject(error));
    }, timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

function buildPrompt(input: {
  runId: string;
  messages: readonly AgentRuntimeMessage[];
  tools: readonly AgentToolDescriptor[];
  promptContext?: {
    stablePrefix: string;
    incrementalTail: string;
  };
}) {
  const runtimeTail = JSON.stringify({
    tools: input.tools,
    messages: input.messages,
    runId: input.runId,
  });
  return input.promptContext
    ? `${input.promptContext.stablePrefix}\n${input.promptContext.incrementalTail}\n${runtimeTail}`
    : runtimeTail;
}

export const AGENT_SYSTEM_PROMPT =
  "你是 Seconda 面试 Agent。每一步先用 assistant 普通文本输出简洁、可公开的处理进度，再且只调用一个当前可用工具。普通文本不是供应商隐藏推理，不得包含隐藏 Chain-of-Thought、内部 Prompt、权限信息、工具私密参数、数据库标识或非必要简历隐私；不要声称它是完整思维过程。需要上下文时调用只读工具；完成分析后必须调用 submit_interview_turn，并让 responseText 成为工具参数中的最后一个字段。候选人可见文本必须严格使用 interview-config.language：zh 使用中文，en 使用英语，es 使用西班牙语，de 使用德语。interview-config.persona 只控制语气和追问强度：friendly 温和鼓励，standard 专业中性，stressful 直接且有压力；Persona 不得改变证据标准、结束条件、评分标准、安全规则或问题上限。开场 assessment 必须为 null 且 coverageChanges 为空；回答轮需在同一终结提案中提交轻量评估、覆盖度变化与下一行动。问题必须基于简历证据，一次只问一个问题；不得生成正式分数，不得虚构简历经历，不得绕过题型和轮次限制。";

function activeToolNames(tools: readonly AgentToolDescriptor[]) {
  const available = new Set<string>(interviewToolNames);
  const names = tools.map((descriptor) => descriptor.name).filter(
    (name): name is InterviewToolName => available.has(name),
  );
  if (names.length !== tools.length) throw new Error("Unknown Agent tool descriptor");
  return names;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
