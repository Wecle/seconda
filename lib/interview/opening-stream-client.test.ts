import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  parseInterviewOpeningSSEBlock,
  parseInterviewRoomEventData,
  parseInterviewRoomPayload,
} from "./client/opening-stream";
import { projectInterviewRoom } from "./projections/room";
import { projectInterviewTranscript } from "./projections/transcript";
import type { InterviewEventSnapshot } from "./projections/types";

test("opening stream parser accepts strict room and completion events", () => {
  const interviewId = randomUUID();
  const runId = randomUUID();
  const roomEvent = {
    type: "room",
    view: {
      room: {
        interviewId,
        phase: "generating_question",
        currentQuestion: null,
        currentRound: 1,
        totalRounds: 5,
        canSubmitAnswer: false,
        canSkip: false,
        canEnd: false,
        retryableRunId: null,
        canRetryCompletion: false,
      },
      transcript: [
        {
          type: "reasoning",
          runId,
          step: 1,
          attempt: 1,
          blockIndex: 0,
          sequence: 3,
          endSequence: 4,
          content: "Inspect the resume.",
          complete: false,
        },
        {
          type: "skill",
          runId,
          sequence: 5,
          name: "resume-deep-dive",
          status: "loaded",
          version: "1.0.0",
          code: null,
        },
      ],
    },
  };

  assert.deepEqual(
    parseInterviewOpeningSSEBlock(`data: ${JSON.stringify(roomEvent)}\n\n`),
    roomEvent,
  );
  assert.deepEqual(parseInterviewRoomPayload(roomEvent.view), roomEvent.view);
  assert.deepEqual(parseInterviewRoomEventData(JSON.stringify(roomEvent)), roomEvent.view);
  assert.deepEqual(parseInterviewOpeningSSEBlock("data: {\"type\":\"complete\",\"ok\":true}"), {
    type: "complete",
    ok: true,
  });
});

test("opening stream parser accepts real projectInterviewRoom outputs for canRetryCompletion false and true", () => {
  const interviewId = randomUUID();
  const questionId = randomUUID();
  const runId = randomUUID();
  const jobId = randomUUID();

  // 1. Active awaiting_answer room (canRetryCompletion = false)
  const roomActive = projectInterviewRoom({
    interview: {
      id: interviewId,
      status: "active",
      answeredRoundCount: 0,
      targetRoundCount: 3,
    },
    currentQuestion: {
      id: questionId,
      sequence: 1,
      kind: "main",
      topic: "React Architecture",
      question: "How do you structure state?",
      tip: null,
      status: "awaiting_answer",
    },
    currentRun: {
      id: runId,
      triggerType: "opening",
      status: "completed",
    },
    completionJob: null,
  });

  const events: InterviewEventSnapshot[] = [
    {
      runId,
      sequence: 1,
      type: "question_generated",
      payload: { questionId, sequence: 1, kind: "main", content: "How do you structure state?" },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
  ];
  const transcript = projectInterviewTranscript({ events });

  const sseDataActive = JSON.stringify({
    type: "room",
    view: {
      room: roomActive,
      transcript,
    },
  });

  const parsedActive = parseInterviewRoomEventData(sseDataActive);
  assert.ok(parsedActive);
  assert.equal(parsedActive.room.canRetryCompletion, false);
  assert.equal(parsedActive.room.phase, "awaiting_answer");
  assert.equal(parsedActive.room.canSubmitAnswer, true);

  // 2. Completing failed job room (canRetryCompletion = true)
  const roomCompletingFailed = projectInterviewRoom({
    interview: {
      id: interviewId,
      status: "completing",
      answeredRoundCount: 1,
      targetRoundCount: 3,
    },
    currentQuestion: null,
    currentRun: null,
    completionJob: {
      id: jobId,
      status: "failed",
    },
  });

  const sseDataFailed = JSON.stringify({
    type: "room",
    view: {
      room: roomCompletingFailed,
      transcript,
    },
  });

  const parsedFailed = parseInterviewRoomEventData(sseDataFailed);
  assert.ok(parsedFailed);
  assert.equal(parsedFailed.room.canRetryCompletion, true);
  assert.equal(parsedFailed.room.phase, "completing");
});

test("opening stream parser parses answers, questions, and skills in transcript without duplication", () => {
  const interviewId = randomUUID();
  const questionId1 = randomUUID();
  const questionId2 = randomUUID();
  const answerId1 = randomUUID();
  const runId1 = randomUUID();
  const runId2 = randomUUID();

  const events: InterviewEventSnapshot[] = [
    {
      runId: runId1,
      sequence: 1,
      type: "interview/question_committed",
      payload: {
        interviewId,
        questionId: questionId1,
        sequence: 1,
        kind: "main",
        topic: "Topic 1",
        question: "Question 1",
        tip: null,
        resumeEvidenceIds: [],
      },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
    {
      runId: null,
      sequence: 2,
      type: "interview/answer_submitted",
      payload: {
        interviewId,
        answerId: answerId1,
        questionId: questionId1,
        sequence: 1,
        content: "My Answer 1",
        skipped: false,
      },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
    {
      runId: runId2,
      sequence: 3,
      type: "step_started",
      payload: { step: 1, attempt: 1 },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId: runId2,
      sequence: 4,
      type: "assistant_chunk",
      payload: { chunk: { type: "block-start", index: 0, blockType: "reasoning" } },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId: runId2,
      sequence: 5,
      type: "assistant_chunk",
      payload: { chunk: { type: "reasoning-delta", index: 0, text: "Evaluating answer 1..." } },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId: runId2,
      sequence: 6,
      type: "assistant_chunk",
      payload: { chunk: { type: "block-end", index: 0, blockType: "reasoning" } },
      schemaVersion: 1,
      visibility: "model",
    },
    {
      runId: runId2,
      sequence: 7,
      type: "interview/question_committed",
      payload: {
        interviewId,
        questionId: questionId2,
        sequence: 2,
        kind: "follow_up",
        topic: "Topic 2",
        question: "Question 2",
        tip: null,
        resumeEvidenceIds: [],
      },
      schemaVersion: 1,
      visibility: "model_and_user",
    },
  ];

  const transcript = projectInterviewTranscript({ events });

  const roomView = {
    room: projectInterviewRoom({
      interview: { id: interviewId, status: "active", answeredRoundCount: 1, targetRoundCount: 3 },
      currentQuestion: {
        id: questionId2,
        sequence: 2,
        kind: "follow_up",
        topic: "Topic 2",
        question: "Question 2",
        tip: null,
        status: "awaiting_answer",
      },
      currentRun: { id: runId2, triggerType: "answer", status: "completed" },
    }),
    transcript,
  };

  const parsed = parseInterviewRoomEventData(JSON.stringify({ type: "room", view: roomView }));
  assert.ok(parsed);
  assert.equal(parsed.transcript.length, 4); // Q1, Answer1, Reasoning, Q2
  assert.equal(parsed.transcript[0].type, "question");
  assert.equal(parsed.transcript[1].type, "answer");
  if (parsed.transcript[1].type === "answer") {
    assert.equal(parsed.transcript[1].content, "My Answer 1");
    assert.equal(parsed.transcript[1].skipped, false);
  }
  assert.equal(parsed.transcript[2].type, "reasoning");
  assert.equal(parsed.transcript[3].type, "question");
});

test("opening stream parser rejects malformed or unsafe envelopes", () => {
  assert.equal(parseInterviewOpeningSSEBlock("event: ping"), null);
  assert.equal(parseInterviewOpeningSSEBlock("data: {\"type\":\"complete\",\"ok\":\"yes\"}"), null);
  assert.equal(parseInterviewOpeningSSEBlock("data: {\"type\":\"room\",\"view\":{},\"extra\":true}"), null);
  assert.equal(parseInterviewOpeningSSEBlock("data: not-json"), null);
  assert.equal(parseInterviewRoomPayload({ room: {}, transcript: [], unsafe: true }), null);
  assert.equal(parseInterviewRoomEventData("not-json"), null);
  assert.equal(parseInterviewRoomEventData(JSON.stringify({ type: "tool_result", view: {} })), null);
});
