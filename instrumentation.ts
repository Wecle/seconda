import { loadModelPolicy } from "@/lib/ai/model-policy";

type Environment = Record<string, string | undefined>;

export function register(env: Environment = process.env) {
  if (env.NEXT_RUNTIME === "edge") return;

  if (!env.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("AI_GATEWAY_API_KEY must be configured");
  }

  loadModelPolicy(env);
}
