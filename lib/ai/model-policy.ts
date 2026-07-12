export type AITask =
  | "resume.parse"
  | "interview.agent"
  | "context.compact"
  | "question.generate"
  | "question.follow-up"
  | "answer.score"
  | "answer.assess"
  | "report.generate"
  | "coach.generate"
  | "coach.evaluate";

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
  "resume.parse": "fast",
  "interview.agent": "fast",
  "context.compact": "quality",
  "question.generate": "fast",
  "question.follow-up": "fast",
  "answer.score": "quality",
  "answer.assess": "fast",
  "report.generate": "quality",
  "coach.generate": "quality",
  "coach.evaluate": "quality",
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
