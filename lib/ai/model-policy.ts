export type AITask =
  | "resume.parse"
  | "question.generate"
  | "question.follow-up"
  | "answer.score"
  | "report.generate"
  | "coach.generate"
  | "coach.evaluate";

export type AIModelTier = "fast" | "quality";

export type ModelPolicy = {
  fastModel: string;
  fastFallbackModel?: string;
  qualityModel: string;
  qualityFallbackModel?: string;
};

const MODEL_ID_PATTERN = /^[^/\s]+\/[^/\s]+$/;

const taskTiers: Record<AITask, AIModelTier> = {
  "resume.parse": "fast",
  "question.generate": "fast",
  "question.follow-up": "fast",
  "answer.score": "quality",
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

function validateModel(name: string, model: string) {
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`${name} must use the creator/model format`);
  }
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

export function resolveModelCandidates(task: AITask, policy: ModelPolicy) {
  const tier = getTaskTier(task);
  const models =
    tier === "fast"
      ? [
          policy.fastModel,
          policy.fastFallbackModel,
          policy.qualityModel,
          policy.qualityFallbackModel,
        ].filter((model): model is string => Boolean(model))
      : [policy.qualityModel, policy.qualityFallbackModel].filter(
          (model): model is string => Boolean(model),
        );

  return { tier, models };
}
