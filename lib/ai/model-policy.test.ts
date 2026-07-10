import assert from "node:assert/strict";
import test from "node:test";
import {
  getTaskTier,
  loadModelPolicy,
  resolveModelCandidates,
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
  "resume.parse": "fast",
  "question.generate": "fast",
  "question.follow-up": "fast",
  "answer.score": "quality",
  "report.generate": "quality",
  "coach.generate": "quality",
  "coach.evaluate": "quality",
};

test("maps every task to its fixed first-phase tier", () => {
  for (const [task, tier] of Object.entries(expectedTiers)) {
    assert.equal(getTaskTier(task as AITask), tier);
  }
});

test("builds fast candidates in escalation order", () => {
  const policy = loadModelPolicy(validEnv);
  assert.deepEqual(resolveModelCandidates("resume.parse", policy), {
    tier: "fast",
    candidates: [
      { model: "deepseek/fast", credentialTier: "fast" },
      { model: "deepseek/fast-backup", credentialTier: "fast" },
      { model: "zhipu/quality", credentialTier: "quality" },
      { model: "zhipu/quality-backup", credentialTier: "quality" },
    ],
  });
});

test("quality candidates never contain fast models", () => {
  const policy = loadModelPolicy(validEnv);
  assert.deepEqual(resolveModelCandidates("answer.score", policy), {
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

test("rejects duplicate configured models", () => {
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_FAST_FALLBACK: "deepseek/fast",
      }),
    /duplicate/i,
  );
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_QUALITY: "deepseek/fast" }),
    /duplicate/i,
  );
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
    AI_MODEL_FAST_FALLBACK: " ",
    AI_APPROVED_MODELS: "deepseek/fast,zhipu/quality",
  });
  assert.deepEqual(resolveModelCandidates("question.generate", policy), {
    tier: "fast",
    candidates: [
      { model: "deepseek/fast", credentialTier: "fast" },
      { model: "zhipu/quality", credentialTier: "quality" },
    ],
  });
});
