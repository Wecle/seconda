import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  parseModelIdentifier,
  type AIModelTier,
  type ModelProvider,
} from "./model-policy";

export type ProviderAdapterMetadata = {
  provider: ModelProvider;
  model: string;
  modelId: string;
  structuredOutput: "json-object" | "sdk-json";
  thinking: "disabled" | "not-configured";
  jsonInstruction?: string;
};

export type ProviderModel = {
  model: LanguageModel;
  metadata: ProviderAdapterMetadata;
};

type ProviderRegistryInput = {
  model: string;
  credentialTier: AIModelTier;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
};

const DEEPSEEK_JSON_INSTRUCTION = "请只返回合法 JSON 对象。";

function compatibleProvider(input: ProviderRegistryInput, provider: "deepseek" | "zhipu") {
  const { modelId } = parseModelIdentifier(input.model);
  const isDeepSeek = provider === "deepseek";
  const baseURL = isDeepSeek
    ? "https://api.deepseek.com"
    : "https://open.bigmodel.cn/api/paas/v4/";

  const instance = createOpenAICompatible({
    name: provider,
    baseURL,
    apiKey: input.apiKey,
    fetch: input.fetch,
    supportsStructuredOutputs: false,
    ...(isDeepSeek
      ? {
          transformRequestBody: (body) => ({
            ...body,
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
          }),
        }
      : {}),
  });

  return {
    model: instance.chatModel(modelId),
    metadata: {
      provider,
      model: input.model,
      modelId,
      structuredOutput: isDeepSeek ? "json-object" : "sdk-json",
      thinking: isDeepSeek ? "disabled" : "not-configured",
      ...(isDeepSeek ? { jsonInstruction: DEEPSEEK_JSON_INSTRUCTION } : {}),
    },
  } satisfies ProviderModel;
}

export function createProviderModel(input: ProviderRegistryInput): ProviderModel {
  const { provider, modelId } = parseModelIdentifier(input.model);

  if (provider === "deepseek" || provider === "zhipu") {
    return compatibleProvider(input, provider);
  }

  const instance = createOpenAI({ apiKey: input.apiKey, fetch: input.fetch });
  return {
    model: instance.chat(modelId),
    metadata: {
      provider,
      model: input.model,
      modelId,
      structuredOutput: "sdk-json",
      thinking: "not-configured",
    },
  };
}
