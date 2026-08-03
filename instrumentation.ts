import { loadModelPolicy } from "@/lib/ai/model-policy";
import { loadAIResourcePolicy } from "@/lib/ai/telemetry/budget";
import { parseModelPricing } from "@/lib/ai/telemetry/pricing";

type Environment = Record<string, string | undefined>;

export function register(env: Environment = process.env) {
  if (env.NEXT_RUNTIME === "edge") return;

  for (const name of ["FAST_MODEL_API_KEY", "QUALITY_MODEL_API_KEY"] as const) {
    if (!env[name]?.trim()) {
      throw new Error(`${name} must be configured`);
    }
  }

  loadModelPolicy(env);
  loadAIResourcePolicy(env);
  parseModelPricing(env.AI_MODEL_PRICING_JSON);
}
