import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { projectInterviewRoom } from "./projections/room";
import { projectInterviewTranscript } from "./projections/transcript";
import type {
  InterviewEventSnapshot,
  InterviewQuestionSnapshot,
  InterviewRunSnapshot,
  InterviewSnapshot,
} from "./projections/types";

const interviewId = randomUUID();
const questionId = randomUUID();
const answerId = randomUUID();
const runId = randomUUID();

function interview(overrides: Partial<InterviewSnapshot> = {}): InterviewSnapshot {
  return {
    id: interviewId,
    status: "active",
    answeredRoundCount: 0,
    targetRoundCount: 5,
    ...overrides,
  };
}

function question(overrides: Partial<InterviewQuestionSnapshot> = {}): InterviewQuestionSnapshot {
  return {
    id: questionId,
    sequence: 1,
    kind: "main",
    topic: "System design",
    question: "How did you design the system?",
    tip: null,
    status: "awaiting_answer",
    ...overrides,
  };
}

function run(overrides: Partial<InterviewRunSnapshot> = {}): InterviewRunSnapshot {
  return {
    id: runId,
    triggerType: "opening",
    status: "completed",
    ...overrides,
  };
}

test("room projection applies the documented phase priority and permissions", () => {
  const cases = [
    { expected: "completed", interview: interview({ status: "completed" }), run: run({ status: "failed" }), question: null },
    { expected: "completing", interview: interview({ status: "completing" }), run: run({ status: "failed" }), question: null },
    { expected: "run_failed", interview: interview(), run: run({ status: "failed" }), question: question() },
    { expected: "generating_question", interview: interview({ status: "initializing" }), run: run({ status: "queued" }), question: null },
    { expected: "evaluating_answer", interview: interview(), run: run({ triggerType: "answer", status: "running" }), question: null },
    { expected: "awaiting_answer", interview: interview(), run: run(), question: question() },
    { expected: "initializing", interview: interview({ status: "initializing" }), run: null, question: null },
    { expected: "invalid_state", interview: interview(), run: run(), question: null },
  ] as const;

  for (const fixture of cases) {
    const view = projectInterviewRoom({
      interview: fixture.interview,
      currentRun: fixture.run,
      currentQuestion: fixture.question,
    });
    assert.equal(view.phase, fixture.expected);
    assert.equal(view.canSubmitAnswer, fixture.expected === "awaiting_answer");
    assert.equal(view.canSkip, fixture.expected === "awaiting_answer");
    assert.equal(view.retryableRunId, fixture.expected === "run_failed" ? runId : null);
  }
});

test("transcript projects only validated public domain events", () => {
  const events: InterviewEventSnapshot[] = [
    {
      runId,
      sequence: 1,
      type: "step_started",
      payload: { step: 1, attempt: 1 },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId,
      sequence: 2,
      type: "assistant_chunk",
      payload: { chunk: { type: "block-start", index: 0, blockType: "reasoning" } },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId,
      sequence: 3,
      type: "assistant_chunk",
      payload: { chunk: { type: "reasoning-delta", index: 0, text: "Inspect the resume. " } },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId,
      sequence: 4,
      type: "assistant_chunk",
      payload: { chunk: { type: "reasoning-delta", index: 0, text: "Ask about system design." } },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId,
      sequence: 5,
      type: "assistant_chunk",
      payload: { chunk: { type: "block-end", index: 0, blockType: "reasoning" } },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId,
      sequence: 6,
      type: "skill_loaded",
      payload: {
        name: "resume-deep-dive",
        version: "1.0.0",
        contentHash: `sha256:${"a".repeat(64)}`,
      },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId,
      sequence: 7,
      type: "interview/session_initialized",
      payload: { interviewId, openingRunId: runId, status: "initializing" },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
    {
      runId,
      sequence: 8,
      type: "interview/question_committed",
      payload: {
        interviewId,
        questionId,
        sequence: 1,
        kind: "main",
        topic: "System design",
        question: "How did you design the system?",
        tip: null,
        resumeEvidenceIds: [],
      },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
    {
      runId,
      sequence: 9,
      type: "interview/answer_submitted",
      payload: { interviewId, answerId, questionId, sequence: 1, content: "With an event log.", skipped: false },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
    {
      runId,
      sequence: 10,
      type: "interview/answer_analyzed",
      payload: { rawAnalysis: "private" },
      schemaVersion: 1,
      visibility: "internal",
    },
  ];

  assert.deepEqual(projectInterviewTranscript({ events }), [
    {
      type: "reasoning",
      runId,
      step: 1,
      attempt: 1,
      blockIndex: 0,
      sequence: 2,
      endSequence: 5,
      content: "Inspect the resume. Ask about system design.",
      complete: true,
    },
    {
      type: "skill",
      runId,
      sequence: 6,
      name: "resume-deep-dive",
      status: "loaded",
      version: "1.0.0",
      code: null,
    },
    { type: "question", questionId, sequence: 1, kind: "main", content: "How did you design the system?" },
    { type: "answer", answerId, questionId, sequence: 1, content: "With an event log.", skipped: false },
  ]);
});

test("transcript fails closed for unordered, unknown, or invalid public events", () => {
  const base: InterviewEventSnapshot = {
    runId,
    sequence: 1,
    type: "interview/session_initialized",
    payload: { interviewId, openingRunId: runId, status: "initializing" },
    schemaVersion: 1,
    visibility: "model_and_user",
  };
  assert.throws(() => projectInterviewTranscript({ events: [base, { ...base }] }), /ascending/);
  assert.throws(() => projectInterviewTranscript({ events: [{ ...base, schemaVersion: 2 }] }), /Unsupported/);
  assert.throws(() => projectInterviewTranscript({ events: [{ ...base, type: "interview/unknown" }] }), /Unsupported/);
  assert.throws(() => projectInterviewTranscript({ events: [{ ...base, payload: { interviewId } }] }));
  assert.throws(() => projectInterviewTranscript({ events: [{ ...base, type: "interview/answer_analyzed" }] }), /Internal/);
  assert.throws(() => projectInterviewTranscript({ events: [{
    ...base,
    type: "assistant_chunk",
    visibility: "model",
    payload: { chunk: { type: "reasoning-delta", index: 0, text: "orphan" } },
  }] }), /step start/);
  assert.throws(() => projectInterviewTranscript({ events: [{
    ...base,
    type: "step_started",
    visibility: "internal",
    payload: { step: 1, attempt: 1 },
  }] }), /private reasoning schema/);
  assert.throws(() => projectInterviewTranscript({ events: [{
    ...base,
    type: "step_started",
    visibility: "model",
    schemaVersion: 2,
    payload: { step: 1, attempt: 1 },
  }] }), /private reasoning schema/);
  assert.throws(() => projectInterviewTranscript({ events: [{
    ...base,
    type: "skill_loaded",
    visibility: "internal",
    payload: { name: "resume-deep-dive", version: "1", contentHash: `sha256:${"a".repeat(64)}` },
  }] }), /private lifecycle schema/);
});

test("transcript keeps reasoning blocks separate across steps and attempts", () => {
  const events: InterviewEventSnapshot[] = [
    { runId, sequence: 1, type: "step_started", payload: { step: 1, attempt: 1 }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 2, type: "assistant_chunk", payload: { chunk: { type: "block-start", index: 0, blockType: "reasoning" } }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 3, type: "assistant_chunk", payload: { chunk: { type: "reasoning-delta", index: 0, text: "first attempt" } }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 4, type: "step_started", payload: { step: 1, attempt: 2 }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 5, type: "assistant_chunk", payload: { chunk: { type: "block-start", index: 0, blockType: "reasoning" } }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 6, type: "assistant_chunk", payload: { chunk: { type: "reasoning-delta", index: 0, text: "retry" } }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 7, type: "assistant_chunk", payload: { chunk: { type: "block-end", index: 0, blockType: "reasoning" } }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 8, type: "step_started", payload: { step: 2, attempt: 1 }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 9, type: "assistant_chunk", payload: { chunk: { type: "block-start", index: 0, blockType: "reasoning" } }, schemaVersion: 1, visibility: "model" },
    { runId, sequence: 10, type: "assistant_chunk", payload: { chunk: { type: "reasoning-delta", index: 0, text: "after tool" } }, schemaVersion: 1, visibility: "model" },
  ];

  const result = projectInterviewTranscript({ events });
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.type === "reasoning" ? {
    step: item.step,
    attempt: item.attempt,
    content: item.content,
    complete: item.complete,
  } : null), [
    { step: 1, attempt: 1, content: "first attempt", complete: false },
    { step: 1, attempt: 2, content: "retry", complete: true },
    { step: 2, attempt: 1, content: "after tool", complete: false },
  ]);
});
