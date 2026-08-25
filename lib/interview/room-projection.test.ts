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
      sequence: 1,
      type: "assistant_message",
      payload: { reasoning: "must never be shown" },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      sequence: 2,
      type: "interview/session_initialized",
      payload: { interviewId, openingRunId: runId, status: "initializing" },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
    {
      sequence: 3,
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
      sequence: 4,
      type: "interview/answer_submitted",
      payload: { interviewId, answerId, questionId, sequence: 1, content: "With an event log.", skipped: false },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
    {
      sequence: 5,
      type: "interview/answer_analyzed",
      payload: { rawAnalysis: "private" },
      schemaVersion: 1,
      visibility: "internal",
    },
  ];

  assert.deepEqual(projectInterviewTranscript({ events }), [
    { type: "question", questionId, sequence: 1, kind: "main", content: "How did you design the system?" },
    { type: "answer", answerId, questionId, sequence: 1, content: "With an event log.", skipped: false },
  ]);
});

test("transcript fails closed for unordered, unknown, or invalid public events", () => {
  const base: InterviewEventSnapshot = {
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
});
