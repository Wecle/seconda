import { z } from "zod";
import type {
  AITaskUsage,
  ModelPriceSnapshot,
  ModelPricingRegistry,
} from "./types";

const safeNonNegativeInteger = z.number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const modelIdentifier = z.string().regex(/^[^/\s]+\/[^/\s]+$/);
const modelPriceSchema = z.strictObject({
  inputMicrosPerMillion: safeNonNegativeInteger,
  outputMicrosPerMillion: safeNonNegativeInteger,
  cacheReadMicrosPerMillion: safeNonNegativeInteger.optional(),
  cacheWriteMicrosPerMillion: safeNonNegativeInteger.optional(),
});
const modelPricingSchema = z.strictObject({
  version: z.literal(1),
  models: z.record(modelIdentifier, modelPriceSchema),
});

export function parseModelPricing(value: string | undefined): ModelPricingRegistry {
  if (!value?.trim()) return { version: 1, models: {} };

  try {
    return modelPricingSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("AI_MODEL_PRICING_JSON is invalid");
  }
}

function isSafeNonNegativeInteger(value: number | null | undefined): value is number {
  return value !== null && value !== undefined &&
    Number.isSafeInteger(value) && value >= 0;
}

function isValidUsage(usage: AITaskUsage) {
  return isSafeNonNegativeInteger(usage.inputTokens) &&
    isSafeNonNegativeInteger(usage.outputTokens) &&
    (usage.cachedInputTokens === null || isSafeNonNegativeInteger(usage.cachedInputTokens)) &&
    (usage.cacheWriteTokens === null || isSafeNonNegativeInteger(usage.cacheWriteTokens));
}

function isValidPrice(price: ModelPriceSnapshot) {
  return isSafeNonNegativeInteger(price.inputMicrosPerMillion) &&
    isSafeNonNegativeInteger(price.outputMicrosPerMillion) &&
    (price.cacheReadMicrosPerMillion === undefined ||
      isSafeNonNegativeInteger(price.cacheReadMicrosPerMillion)) &&
    (price.cacheWriteMicrosPerMillion === undefined ||
      isSafeNonNegativeInteger(price.cacheWriteMicrosPerMillion));
}

export function calculateAttemptCost(
  usage: AITaskUsage,
  price: ModelPriceSnapshot | undefined,
): number | null {
  if (!price || !isValidUsage(usage) || !isValidPrice(price)) return null;

  const cacheReadTokens = usage.cachedInputTokens ?? 0;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  if (cacheReadTokens + cacheWriteTokens > usage.inputTokens) return null;
  if (usage.cachedInputTokens !== null && price.cacheReadMicrosPerMillion === undefined) {
    return null;
  }
  if (usage.cacheWriteTokens !== null && price.cacheWriteMicrosPerMillion === undefined) {
    return null;
  }

  const normalInputTokens = usage.inputTokens - cacheReadTokens - cacheWriteTokens;
  const numerator =
    BigInt(normalInputTokens) * BigInt(price.inputMicrosPerMillion) +
    BigInt(usage.outputTokens) * BigInt(price.outputMicrosPerMillion) +
    BigInt(cacheReadTokens) * BigInt(price.cacheReadMicrosPerMillion ?? 0) +
    BigInt(cacheWriteTokens) * BigInt(price.cacheWriteMicrosPerMillion ?? 0);
  const roundedMicros = (numerator + BigInt(500_000)) / BigInt(1_000_000);
  if (roundedMicros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(roundedMicros);
}
