import assert from "node:assert/strict";
import test from "node:test";
import {
  getTaskTier,
  loadModelPolicy,
  resolveModelCandidates,
  resolveModelCredential,
  type AITask,
  type AIModelTier,
} from "./model-policy";

const validEnv = {
  AI_MODEL_FAST: "deepseek/fast",
  AI_MODEL_FAST_FALLBACK: "deepseek/fast-backup",
  AI_MODEL_QUALITY: "zhipu/quality",
  AI_MODEL_QUALITY_FALLBACK: "zhipu/quality-backup",
  AI_APPROVED_MODELS:
    "deepseek/fast,deepseek/fast-backup,zhipu/quality,zhipu/quality-backup",
};

const expectedTiers: Record<AITask, AIModelTier> = {
  "resume.parse": "quality",
  "resume.generate": "quality",
  "interview.question_scoring": "quality",
  "interview.report_generation": "quality",
  "jd.parse": "fast",
};

test("maps every task to its fixed first-phase tier", () => {
  for (const [task, tier] of Object.entries(expectedTiers)) {
    assert.equal(getTaskTier(task as AITask), tier);
  }
});

test("builds quality candidates for structured tasks", () => {
  const policy = loadModelPolicy(validEnv);
  assert.deepEqual(resolveModelCandidates("resume.parse", policy), {
    tier: "quality",
    candidates: [
      { model: "zhipu/quality", credentialTier: "quality" },
      { model: "zhipu/quality-backup", credentialTier: "quality" },
    ],
  });
});

test("requires both primary tiers", () => {
  assert.throws(() => loadModelPolicy({}), /AI_MODEL_FAST/);
  assert.throws(
    () => loadModelPolicy({ AI_MODEL_FAST: "deepseek/fast" }),
    /AI_MODEL_QUALITY/,
  );
});

test("rejects malformed creator/model identifiers", () => {
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_FAST: "fast" }),
    /creator\/model/,
  );
});

test("validates optional and quality model identifiers", () => {
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_FAST_FALLBACK: "invalid" }),
    /creator\/model/,
  );
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_QUALITY: "invalid" }),
    /creator\/model/,
  );
});

test("rejects unsupported provider prefixes", () => {
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_FAST: "google/fast" }),
    /supported provider prefix/,
  );
});

test("requires primary and fallback providers to match inside each tier", () => {
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_FAST_FALLBACK: "openai/fast-backup" }),
    /fast primary and fallback/i,
  );
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_QUALITY_FALLBACK: "openai/quality-backup" }),
    /quality primary and fallback/i,
  );
});

test("rejects duplicate primary and fallback models within the same tier", () => {
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_FAST_FALLBACK: "deepseek/fast",
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_QUALITY_FALLBACK: "zhipu/quality",
      }),
    /duplicate/i,
  );
});

test("allows fast and quality tiers to use the same model", () => {
  const sameModelEnv = {
    AI_MODEL_FAST: "deepseek/fast",
    AI_MODEL_QUALITY: "deepseek/fast",
    AI_APPROVED_MODELS: "deepseek/fast",
  };
  const policy = loadModelPolicy(sameModelEnv);
  assert.equal(policy.fastModel, "deepseek/fast");
  assert.equal(policy.qualityModel, "deepseek/fast");
});

test("deduplicates candidate models when fast tier falls back to shared quality model", () => {
  const policy = loadModelPolicy({
    AI_MODEL_FAST: "deepseek/chat",
    AI_MODEL_QUALITY: "deepseek/chat",
    AI_MODEL_QUALITY_FALLBACK: "deepseek/reasoner",
    AI_APPROVED_MODELS: "deepseek/chat,deepseek/reasoner",
  });
  assert.deepEqual(resolveModelCandidates("resume.parse", policy), {
    tier: "quality",
    candidates: [
      { model: "deepseek/chat", credentialTier: "quality" },
      { model: "deepseek/reasoner", credentialTier: "quality" },
    ],
  });
});

test("rejects configured models outside the approved registry", () => {
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_FAST: "deepseek/unapproved",
      }),
    /approved/i,
  );
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_QUALITY_FALLBACK: "zhipu/unapproved-quality",
      }),
    /approved/i,
  );
});

test("requires a non-empty approved-model registry", () => {
  const withoutRegistry: Partial<typeof validEnv> = { ...validEnv };
  delete withoutRegistry.AI_APPROVED_MODELS;
  assert.throws(() => loadModelPolicy(withoutRegistry), /AI_APPROVED_MODELS/);
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_APPROVED_MODELS: " " }),
    /AI_APPROVED_MODELS/,
  );
});

test("trims optional fallback values", () => {
  const policy = loadModelPolicy({
    AI_MODEL_FAST: " deepseek/fast ",
    AI_MODEL_QUALITY: " zhipu/quality ",
    AI_MODEL_QUALITY_FALLBACK: " ",
    AI_APPROVED_MODELS: "deepseek/fast,zhipu/quality",
  });
  assert.deepEqual(resolveModelCandidates("resume.generate", policy), {
    tier: "quality",
    candidates: [
      { model: "zhipu/quality", credentialTier: "quality" },
    ],
  });
});

test("resolves credential tier and api key for models", () => {
  const env = {
    ...validEnv,
    FAST_MODEL_API_KEY: "fast-key",
    QUALITY_MODEL_API_KEY: "quality-key",
  };
  assert.deepEqual(resolveModelCredential("deepseek/fast", env), {
    tier: "fast",
    apiKey: "fast-key",
  });
  assert.deepEqual(resolveModelCredential("zhipu/quality", env), {
    tier: "quality",
    apiKey: "quality-key",
  });
});

test("resolves credentials when fast and quality tiers use the same model", () => {
  const sameModelEnv = {
    AI_MODEL_FAST: "deepseek/fast",
    AI_MODEL_QUALITY: "deepseek/fast",
    AI_APPROVED_MODELS: "deepseek/fast",
    FAST_MODEL_API_KEY: "fast-key",
    QUALITY_MODEL_API_KEY: "quality-key",
  };
  assert.deepEqual(resolveModelCredential("deepseek/fast", sameModelEnv, "fast"), {
    tier: "fast",
    apiKey: "fast-key",
  });
  assert.deepEqual(resolveModelCredential("deepseek/fast", sameModelEnv, "quality"), {
    tier: "quality",
    apiKey: "quality-key",
  });
  assert.deepEqual(resolveModelCredential("deepseek/fast", sameModelEnv), {
    tier: "fast",
    apiKey: "fast-key",
  });
});
