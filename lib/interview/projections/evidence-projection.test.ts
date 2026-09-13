import test from "node:test";
import assert from "node:assert/strict";
import { projectInterviewTranscript } from "./transcript";
import { projectInterviewRoom } from "./room";

test("transcript projection includes resumeEvidenceIds for question items", () => {
  const events = [
    {
      runId: "b8f526b7-8ce6-42d4-a130-9b4f2c96c421",
      sequence: 1,
      type: "interview/question_committed",
      schemaVersion: 1,
      visibility: "user" as const,
      payload: {
        interviewId: "018f4fd4-7e9b-7359-99ff-4aa651b14a90",
        questionId: "3df1db8c-02cf-4b68-b7fb-586bce50ad66",
        sequence: 1,
        kind: "main" as const,
        topic: "React 性能优化",
        question: "请介绍你在项目中是如何做 React 性能优化的？",
        tip: null,
        resumeEvidenceIds: ["ev_1234567890abcdef", "ev_abcdef1234567890"],
      },
    },
  ];

  const transcript = projectInterviewTranscript({ events });
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].type, "question");
  if (transcript[0].type === "question") {
    assert.deepEqual(transcript[0].resumeEvidenceIds, ["ev_1234567890abcdef", "ev_abcdef1234567890"]);
  }
});

test("room projection includes resumeEvidenceIds on currentQuestion", () => {
  const room = projectInterviewRoom({
    interview: {
      id: "018f4fd4-7e9b-7359-99ff-4aa651b14a90",
      status: "active",
      answeredRoundCount: 0,
      targetRoundCount: 5,
    },
    currentQuestion: {
      id: "3df1db8c-02cf-4b68-b7fb-586bce50ad66",
      sequence: 1,
      kind: "main",
      topic: "React 性能优化",
      question: "请介绍你在项目中是如何做 React 性能优化的？",
      tip: null,
      status: "awaiting_answer",
      resumeEvidenceIds: ["ev_1234567890abcdef"],
    },
    currentRun: null,
    completionJob: null,
  });

  assert.equal(room.currentQuestion?.id, "3df1db8c-02cf-4b68-b7fb-586bce50ad66");
  assert.deepEqual(room.currentQuestion?.resumeEvidenceIds, ["ev_1234567890abcdef"]);
});
