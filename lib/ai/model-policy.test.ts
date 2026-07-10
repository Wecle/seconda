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
  AI_MODEL_FAST: "google/fast",
  AI_MODEL_FAST_FALLBACK: "openai/fast-backup",
  AI_MODEL_QUALITY: "anthropic/quality",
  AI_MODEL_QUALITY_FALLBACK: "openai/quality-backup",
  AI_APPROVED_MODELS:
    "google/fast,openai/fast-backup,anthropic/quality,openai/quality-backup",
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
    models: [
      "google/fast",
      "openai/fast-backup",
      "anthropic/quality",
      "openai/quality-backup",
    ],
  });
});

test("quality candidates never contain fast models", () => {
  const policy = loadModelPolicy(validEnv);
  assert.deepEqual(resolveModelCandidates("answer.score", policy), {
    tier: "quality",
    models: ["anthropic/quality", "openai/quality-backup"],
  });
});

test("requires both primary tiers", () => {
  assert.throws(() => loadModelPolicy({}), /AI_MODEL_FAST/);
  assert.throws(
    () => loadModelPolicy({ AI_MODEL_FAST: "google/fast" }),
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

test("rejects duplicate configured models", () => {
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_FAST_FALLBACK: "google/fast",
      }),
    /duplicate/i,
  );
  assert.throws(
    () => loadModelPolicy({ ...validEnv, AI_MODEL_QUALITY: "google/fast" }),
    /duplicate/i,
  );
});

test("rejects configured models outside the approved registry", () => {
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_FAST: "google/unapproved",
      }),
    /approved/i,
  );
  assert.throws(
    () =>
      loadModelPolicy({
        ...validEnv,
        AI_MODEL_QUALITY_FALLBACK: "openai/unapproved-quality",
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
    AI_MODEL_FAST: " google/fast ",
    AI_MODEL_QUALITY: " anthropic/quality ",
    AI_MODEL_FAST_FALLBACK: " ",
    AI_APPROVED_MODELS: "google/fast,anthropic/quality",
  });
  assert.deepEqual(resolveModelCandidates("question.generate", policy), {
    tier: "fast",
    models: ["google/fast", "anthropic/quality"],
  });
});
