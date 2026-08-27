export type AITask =
  | "resume.parse"
  | "resume.generate"
  | "interview.question_scoring"
  | "interview.report_generation";

export type AIModelTier = "fast" | "quality";

export type ModelProvider = "deepseek" | "openai" | "zhipu";

export type ModelCandidate = {
  model: string;
  credentialTier: AIModelTier;
};

export type ModelPolicy = {
  fastModel: string;
  fastFallbackModel?: string;
  qualityModel: string;
  qualityFallbackModel?: string;
};

const MODEL_ID_PATTERN = /^[^/\s]+\/[^/\s]+$/;
const supportedProviders = new Set<ModelProvider>(["deepseek", "openai", "zhipu"]);

const taskTiers: Record<AITask, AIModelTier> = {
  "resume.parse": "quality",
  "resume.generate": "quality",
  "interview.question_scoring": "quality",
  "interview.report_generation": "quality",
};

type ModelEnvironment = Record<string, string | undefined>;

function readValue(env: ModelEnvironment, name: string, required = false) {
  const value = env[name]?.trim();
  if (required && !value) {
    throw new Error(`${name} must be configured`);
  }
  return value || undefined;
}

export function parseModelIdentifier(model: string): {
  provider: ModelProvider;
  modelId: string;
} {
  const [provider, modelId] = model.split("/");
  if (!provider || !modelId || !supportedProviders.has(provider as ModelProvider)) {
    throw new Error(`${model} must use a supported provider prefix`);
  }

  return { provider: provider as ModelProvider, modelId };
}

function validateModel(name: string, model: string) {
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`${name} must use the creator/model format`);
  }

  parseModelIdentifier(model);
}

export function loadModelPolicy(env: ModelEnvironment = process.env): Readonly<ModelPolicy> {
  const fastModel = readValue(env, "AI_MODEL_FAST", true)!;
  const qualityModel = readValue(env, "AI_MODEL_QUALITY", true)!;
  const fastFallbackModel = readValue(env, "AI_MODEL_FAST_FALLBACK");
  const qualityFallbackModel = readValue(env, "AI_MODEL_QUALITY_FALLBACK");
  const approvedModels = readValue(env, "AI_APPROVED_MODELS", true)!;

  const configured = [
    ["AI_MODEL_FAST", fastModel],
    ["AI_MODEL_FAST_FALLBACK", fastFallbackModel],
    ["AI_MODEL_QUALITY", qualityModel],
    ["AI_MODEL_QUALITY_FALLBACK", qualityFallbackModel],
  ] as const;

  for (const [name, model] of configured) {
    if (model) validateModel(name, model);
  }

  const modelValues = configured.flatMap(([, model]) => (model ? [model] : []));
  if (new Set(modelValues).size !== modelValues.length) {
    throw new Error("Configured models must not contain duplicates");
  }

  const registry = new Set(
    approvedModels.split(",").map((model) => model.trim()).filter(Boolean),
  );
  if (registry.size === 0) {
    throw new Error("AI_APPROVED_MODELS must contain at least one model");
  }

  const validateTierProvider = (primary: string, fallback: string | undefined, tier: AIModelTier) => {
    if (fallback && parseModelIdentifier(primary).provider !== parseModelIdentifier(fallback).provider) {
      throw new Error(`${tier} primary and fallback models must use the same provider prefix`);
    }
  };

  validateTierProvider(fastModel, fastFallbackModel, "fast");
  validateTierProvider(qualityModel, qualityFallbackModel, "quality");

  for (const model of modelValues) {
    if (!registry.has(model)) {
      throw new Error(`Configured model ${model} is not in AI_APPROVED_MODELS`);
    }
  }

  return {
    fastModel,
    fastFallbackModel,
    qualityModel,
    qualityFallbackModel,
  };
}

export function getTaskTier(task: AITask): AIModelTier {
  return taskTiers[task];
}

export function resolveModelCandidates(task: AITask, policy: ModelPolicy): {
  tier: AIModelTier;
  candidates: ModelCandidate[];
} {
  const tier = getTaskTier(task);
  const fastCandidates: ModelCandidate[] = [
    { model: policy.fastModel, credentialTier: "fast" },
    ...(policy.fastFallbackModel
      ? [{ model: policy.fastFallbackModel, credentialTier: "fast" as const }]
      : []),
  ];
  const qualityCandidates: ModelCandidate[] = [
    { model: policy.qualityModel, credentialTier: "quality" },
    ...(policy.qualityFallbackModel
      ? [{ model: policy.qualityFallbackModel, credentialTier: "quality" as const }]
      : []),
  ];

  return { tier, candidates: tier === "fast" ? [...fastCandidates, ...qualityCandidates] : qualityCandidates };
}

export function resolveModelCredential(
  model: string,
  env: ModelEnvironment = process.env,
): {
  tier: AIModelTier;
  apiKey: string;
} {
  const fastKey = env.FAST_MODEL_API_KEY?.trim();
  const qualityKey = env.QUALITY_MODEL_API_KEY?.trim();

  try {
    const policy = loadModelPolicy(env);
    if (model === policy.qualityModel || model === policy.qualityFallbackModel) {
      if (!qualityKey) {
        throw new Error("QUALITY_MODEL_API_KEY must be configured");
      }
      return { tier: "quality", apiKey: qualityKey };
    }
    if (model === policy.fastModel || model === policy.fastFallbackModel) {
      if (!fastKey) {
        throw new Error("FAST_MODEL_API_KEY must be configured");
      }
      return { tier: "fast", apiKey: fastKey };
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("FAST_MODEL_API_KEY") ||
        error.message.includes("QUALITY_MODEL_API_KEY"))
    ) {
      throw error;
    }
  }

  const fallbackKey = fastKey ?? qualityKey;
  if (!fallbackKey) {
    throw new Error("FAST_MODEL_API_KEY must be configured");
  }
  return { tier: "fast", apiKey: fallbackKey };
}
