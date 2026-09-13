import test from "node:test";
import assert from "node:assert/strict";
import { computeHighlightState } from "./use-interview-resume-highlight";
import type { InterviewTranscriptItem, InterviewQuestionView } from "@/lib/interview/projections/types";

test("computeHighlightState aggregates all persistentEvidenceIds from transcript and current question", () => {
  const transcript: InterviewTranscriptItem[] = [
    {
      type: "question",
      questionId: "q1",
      sequence: 1,
      kind: "main",
      content: "Q1",
      resumeEvidenceIds: ["ev_1", "ev_2"],
    },
    {
      type: "answer",
      answerId: "a1",
      questionId: "q1",
      sequence: 2,
      content: "A1",
      skipped: false,
    },
    {
      type: "question",
      questionId: "q2",
      sequence: 3,
      kind: "main",
      content: "Q2",
      resumeEvidenceIds: ["ev_3"],
    },
  ];

  const currentQuestion: InterviewQuestionView = {
    id: "q3",
    sequence: 4,
    kind: "main",
    topic: "Topic",
    content: "Q3",
    tip: null,
    resumeEvidenceIds: ["ev_4"],
  };

  const evidenceJson = {
    ev_1: { path: "skills[0]", text: "TypeScript" },
    ev_2: { path: "experience[0].title", text: "Senior Engineer" },
    ev_3: { path: "education[0].school", text: "MIT" },
    ev_4: { path: "projects[0].name", text: "Seconda" },
  };

  const result = computeHighlightState({
    transcript,
    currentQuestion,
    focusedQuestionId: null,
    evidenceJson,
  });

  assert.deepEqual(Array.from(result.persistentEvidenceIds).sort(), ["ev_1", "ev_2", "ev_3", "ev_4"]);
  assert.deepEqual(Array.from(result.activeEvidenceIds), ["ev_4"]);
  assert.equal(result.isInheritedFromParent, false);
  assert.ok(result.activeEvidencePaths.has("projects[0].name"));
});

test("computeHighlightState inherits evidence from parent main question when follow_up has empty evidence", () => {
  const transcript: InterviewTranscriptItem[] = [
    {
      type: "question",
      questionId: "q1",
      sequence: 1,
      kind: "main",
      content: "Tell me about project X",
      resumeEvidenceIds: ["ev_proj_x"],
    },
    {
      type: "answer",
      answerId: "a1",
      questionId: "q1",
      sequence: 2,
      content: "I did Y on project X",
      skipped: false,
    },
  ];

  const currentQuestion: InterviewQuestionView = {
    id: "q2",
    sequence: 3,
    kind: "follow_up",
    topic: "Follow up on project X",
    content: "Why did you choose Y?",
    tip: null,
    resumeEvidenceIds: [], // Empty follow-up evidence
  };

  const evidenceJson = {
    ev_proj_x: { path: "projects[0].description", text: "Project X" },
  };

  const result = computeHighlightState({
    transcript,
    currentQuestion,
    focusedQuestionId: null,
    evidenceJson,
  });

  assert.deepEqual(Array.from(result.activeEvidenceIds), ["ev_proj_x"]);
  assert.equal(result.isInheritedFromParent, true);
  assert.ok(result.activeEvidencePaths.has("projects[0].description"));
});

test("computeHighlightState switches active evidence when focusedQuestionId points to a past question", () => {
  const transcript: InterviewTranscriptItem[] = [
    {
      type: "question",
      questionId: "q1",
      sequence: 1,
      kind: "main",
      content: "Q1",
      resumeEvidenceIds: ["ev_1"],
    },
    {
      type: "answer",
      answerId: "a1",
      questionId: "q1",
      sequence: 2,
      content: "A1",
      skipped: false,
    },
  ];

  const currentQuestion: InterviewQuestionView = {
    id: "q2",
    sequence: 3,
    kind: "main",
    topic: "Topic 2",
    content: "Q2",
    tip: null,
    resumeEvidenceIds: ["ev_2"],
  };

  const evidenceJson = {
    ev_1: { path: "skills[0]", text: "TypeScript" },
    ev_2: { path: "skills[1]", text: "React" },
  };

  const result = computeHighlightState({
    transcript,
    currentQuestion,
    focusedQuestionId: "q1",
    evidenceJson,
  });

  assert.deepEqual(Array.from(result.activeEvidenceIds), ["ev_1"]);
  assert.equal(result.isInheritedFromParent, false);
  assert.ok(result.activeEvidencePaths.has("skills[0]"));
});
