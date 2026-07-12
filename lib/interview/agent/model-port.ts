import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { generateStructured } from "@/lib/ai/generate-structured";
import { classifyModelError } from "@/lib/ai/model-errors";
import {
  loadModelPolicy,
  resolveModelCandidates,
  type ModelCandidate,
} from "@/lib/ai/model-policy";
import {
  applyStructuredOutputInstructions,
  createProviderModel,
  createProviderOutput,
} from "@/lib/ai/provider-registry";
import { runAgentAttempts } from "./attempt-controller";
import {
  type AgentModelStep,
} from "./contracts";
import {
  createAgentProviderStepSchema,
  interviewToolNames,
  type InterviewToolName,
} from "./tool-registry";
import { normalizeModelUsage, type NormalizedModelUsage } from "./context/telemetry";

export type AgentRuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type AgentToolDescriptor = {
  name: string;
  description: string;
};

export type ProvisionalDelta = {
  messageId: string;
  attemptId: string;
  text: string;
};

type NextStepInput = {
  runId: string;
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
    onProvisionalDelta: (delta: ProvisionalDelta) => Promise<void>;
  }): Promise<{
    step: AgentModelStep;
    attemptId: string;
    provisionalMessageId: string | null;
  }>;
}

type CandidateStream = {
  partialOutputStream: AsyncIterable<unknown>;
  output: PromiseLike<unknown>;
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
  return {
    nextStep(input) {
      const providerSchema = createAgentProviderStepSchema(activeToolNames(input.tools));
      return generateStructured({
        task: "interview.agent",
        schema: providerSchema,
        abortSignal: input.signal,
        system: AGENT_SYSTEM_PROMPT,
        prompt: buildPrompt(input),
      });
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
        onAttemptStarted: async (attempt) => {
          const messageId = options.createMessageId?.() ?? randomUUID();
          messageIds.set(attempt.attemptId, messageId);
          await options.onAttemptStarted({
            ...attempt,
            provisionalMessageId: messageId,
          });
          await input.onAttemptStarted?.({
            ...attempt,
            provisionalMessageId: messageId,
          });
        },
        attempt: async ({ model, attemptId, acceptProvisional }) => {
          const stream = await options.streamCandidate({
            model,
            runId: input.runId,
            messages: input.messages,
            tools: input.tools,
            signal: input.signal,
          });
          void Promise.resolve(stream.output).catch(() => {});
          let question = "";
          const iterator = stream.partialOutputStream[Symbol.asyncIterator]();
          while (true) {
            const next = await withIdleTimeout(
              iterator.next(),
              options.idleTimeoutMs ?? 25_000,
              input.signal,
            );
            if (next.done) break;
            await input.onProviderProgress();
            const partialQuestion = readPartialQuestion(next.value);
            if (!partialQuestion || !partialQuestion.startsWith(question)) continue;
            const suffix = partialQuestion.slice(question.length);
            question = partialQuestion;
            if (!suffix) continue;
            acceptProvisional();
            await input.onProvisionalDelta({
              messageId: messageIds.get(attemptId)!,
              attemptId,
              text: suffix,
            });
          }
          const output = await withIdleTimeout(
            Promise.resolve(stream.output),
            options.idleTimeoutMs ?? 25_000,
            input.signal,
          );
          await input.onProviderProgress();
          if (stream.usage) {
            await options.onUsage?.({
              runId: input.runId,
              usage: normalizeModelUsage(await Promise.resolve(stream.usage)),
            });
          }
          return providerSchema.parse(output);
        },
      });
      return {
        step: result.value,
        attemptId: result.attemptId,
        provisionalMessageId: messageIds.get(result.attemptId) ?? null,
      };
    },
  };
}

export function createStructuredInterviewAgentModelPort(options?: {
  onUsage?: (input: { runId: string; usage: NormalizedModelUsage }) => Promise<void>;
}): InterviewAgentModelPort {
  const policy = loadModelPolicy(process.env);
  const { candidates } = resolveModelCandidates("interview.agent", policy);
  return createStreamingInterviewAgentModelPort({
    candidates,
    idleTimeoutMs: readPositiveInteger(
      process.env.INTERVIEW_AGENT_PROVIDER_IDLE_MS,
      25_000,
    ),
    classifyError: (error) =>
      classifyModelError(error) === "transient" ? "transient" : "fatal",
    async onAttemptStarted() {},
    onUsage: options?.onUsage,
    async streamCandidate(input) {
      const candidate = candidates.find((item) => item.model === input.model);
      if (!candidate) throw new Error(`Unknown Agent model candidate: ${input.model}`);
      return createProviderAgentStream(candidate, input);
    },
  });
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
) {
  const keyName = candidate.credentialTier === "fast"
    ? "FAST_MODEL_API_KEY"
    : "QUALITY_MODEL_API_KEY";
  const apiKey = process.env[keyName]?.trim();
  if (!apiKey) throw new Error(`${keyName} must be configured`);
  const provider = createProviderModel({ ...candidate, apiKey });
  const providerSchema = createAgentProviderStepSchema(activeToolNames(input.tools));
  return streamText({
    model: provider.model,
    system: applyStructuredOutputInstructions(
      AGENT_SYSTEM_PROMPT,
      providerSchema,
      provider.metadata,
    ),
    prompt: buildPrompt(input),
    abortSignal: input.signal,
    maxRetries: 0,
    output: createProviderOutput(providerSchema, provider.metadata),
  });
}

function readPartialQuestion(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const partial = value as { type?: unknown; args?: unknown };
  if (partial.type !== "tool_call" || !partial.args || typeof partial.args !== "object") {
    return null;
  }
  const question = (partial.args as { question?: unknown }).question;
  return typeof question === "string" ? question : null;
}

function withIdleTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  signal: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(() => {
      reject(Object.assign(new Error("Provider stream made no progress"), {
        code: "PROVIDER_IDLE_TIMEOUT",
      }));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
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

const AGENT_SYSTEM_PROMPT =
  "你是 Seconda 面试 Agent。每一步必须返回且只返回一个符合 Schema 的工具调用，禁止返回最终文本或内部状态。候选人可见内容必须通过 ask_interview_question 或 finish_interview 工具提交。最新回答的轻量评估已经由系统提交，请基于评估、覆盖度和简历证据选择一个追问、一个新主题或结束；追问必须先简短评价已确认的回答内容，再只问一个问题。评价中的每项事实都要提供简历证据ID或answer:消息ID，无法确认时改成询问句。不得生成或写入正式分数，不得虚构简历经历，不得绕过题型和轮次限制。";

function activeToolNames(tools: readonly AgentToolDescriptor[]) {
  const available = new Set<string>(interviewToolNames);
  const names = tools.map((tool) => tool.name).filter(
    (name): name is InterviewToolName => available.has(name),
  );
  if (names.length !== tools.length) throw new Error("Unknown Agent tool descriptor");
  return names;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
