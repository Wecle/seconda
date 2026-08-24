import type { AITask, AIModelTier, ModelProvider } from "../model-policy";

export type AITaskTelemetryContext = {
  operationKey: string;
  budgetScope?: string;
  promptTemplateVersion?: string;
};

export type AITaskUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
};

export type ModelPriceSnapshot = {
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  cacheReadMicrosPerMillion?: number;
  cacheWriteMicrosPerMillion?: number;
};

export type ModelPricingRegistry = {
  version: 1;
  models: Record<string, ModelPriceSnapshot>;
};

export type AITaskIdentity = {
  task: AITask;
  context: AITaskTelemetryContext;
};

export type AIAttemptIdentity = {
  attemptNumber: number;
  provider: ModelProvider;
  model: string;
  credentialTier: AIModelTier;
};
