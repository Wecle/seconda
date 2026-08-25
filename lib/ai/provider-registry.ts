import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  parseModelIdentifier,
  type AIModelTier,
  type ModelProvider,
} from "./model-policy";
import { resolveContextWindow } from "@/lib/agent/context-budget";

export type ProviderAdapterMetadata = {
  provider: ModelProvider;
  model: string;
  modelId: string;
  structuredOutput: "json-object" | "json-schema";
  thinking: "enabled" | "disabled" | "not-configured";
  contextWindow: number;
  jsonInstruction?: string;
};

export type ProviderModel = {
  model: LanguageModel;
  metadata: ProviderAdapterMetadata;
};

export type ProviderResponseMode = "structured" | "conversational";

type ProviderRegistryInput = {
  model: string;
  credentialTier: AIModelTier;
  apiKey: string;
  responseMode: ProviderResponseMode;
  fetch?: typeof globalThis.fetch;
};

const DEEPSEEK_JSON_INSTRUCTION = "请只返回合法 JSON 对象。";

function providerBaseUrl(provider: ModelProvider, fallback: string, env: Record<string, string | undefined> = process.env) {
  const configured = env.AI_PROVIDER_BASE_URLS_JSON?.trim();
  if (!configured) return fallback;
  const parsed = JSON.parse(configured) as Record<string, unknown>;
  const value = parsed[provider];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`Base URL for ${provider} must be a string`);
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`Base URL for ${provider} must use HTTPS or local HTTP`);
  }
  return url.toString().replace(/\/$/, "");
}

export function applyStructuredOutputInstructions<TSchema extends z.ZodType>(
  system: string,
  schema: TSchema,
  metadata: ProviderAdapterMetadata,
) {
  if (!metadata.jsonInstruction) return system;

  return `${system}\n\n${metadata.jsonInstruction} 输出必须严格符合以下 JSON Schema；填充所有必填字段，不要添加 Schema 以外的字段：\n${JSON.stringify(z.toJSONSchema(schema))}`;
}

export function createProviderOutput<TSchema extends z.ZodType>(
  schema: TSchema,
  metadata: ProviderAdapterMetadata,
) {
  return metadata.structuredOutput === "json-object"
    ? Output.json()
    : Output.object({ schema });
}

function compatibleProvider(input: ProviderRegistryInput, provider: "deepseek" | "zhipu") {
  const { modelId } = parseModelIdentifier(input.model);
  const isDeepSeek = provider === "deepseek";
  const defaultBaseURL = isDeepSeek
    ? "https://api.deepseek.com"
    : "https://open.bigmodel.cn/api/paas/v4/";
  const baseURL = providerBaseUrl(provider, defaultBaseURL);

  const instance = createOpenAICompatible({
    name: provider,
    baseURL,
    apiKey: input.apiKey,
    fetch: input.fetch,
    supportsStructuredOutputs: false,
    transformRequestBody: (body) => ({
      ...body,
      ...(input.responseMode === "conversational" ? { parallel_tool_calls: false } : {}),
      ...(isDeepSeek
        ? {
            ...(input.responseMode === "structured" ? { response_format: { type: "json_object" } } : {}),
            thinking: { type: input.responseMode === "conversational" ? "enabled" : "disabled" },
          }
        : {}),
    }),
  });

  return {
    model: instance.chatModel(modelId),
    metadata: {
      provider,
      model: input.model,
      modelId,
      structuredOutput: "json-object",
      thinking: isDeepSeek
        ? input.responseMode === "conversational" ? "enabled" : "disabled"
        : "not-configured",
      contextWindow: resolveContextWindow(input.model),
      ...(isDeepSeek ? { jsonInstruction: DEEPSEEK_JSON_INSTRUCTION } : {}),
    },
  } satisfies ProviderModel;
}

export function createProviderModel(input: ProviderRegistryInput): ProviderModel {
  const { provider, modelId } = parseModelIdentifier(input.model);

  if (provider === "deepseek" || provider === "zhipu") {
    return compatibleProvider(input, provider);
  }

  const instance = createOpenAI({
    apiKey: input.apiKey,
    fetch: input.fetch,
    baseURL: providerBaseUrl("openai", "https://api.openai.com/v1"),
  });
  return {
    model: instance.chat(modelId),
    metadata: {
      provider,
      model: input.model,
      modelId,
      structuredOutput: "json-schema",
      thinking: "not-configured",
      contextWindow: resolveContextWindow(input.model),
    },
  };
}
