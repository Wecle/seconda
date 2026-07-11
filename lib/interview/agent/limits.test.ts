import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeInterviewAction,
  type InterviewActionInput,
} from "./limits";

const base: InterviewActionInput = {
  candidateRoundCount: 4,
  categoryCounts: { technical_depth: 2 },
  recentQuestions: ["请解释你在 Seconda 中的缓存策略。"],
  requestedUserEnd: false,
  proposal: {
    action: "ask",
    category: "technical_depth",
    intent: "follow_up",
    question: "为什么选择这个缓存策略？",
    resumeEvidenceIds: ["project:seconda"],
  },
};

test("allows the first three questions in a category", () => {
  for (const questionCount of [0, 1, 2]) {
    assert.deepEqual(
      authorizeInterviewAction({
        ...base,
        categoryCounts: { technical_depth: questionCount },
      }),
      { allowed: true, action: "ask" },
    );
  }
});

test("rejects the fourth question in a category", () => {
  assert.deepEqual(
    authorizeInterviewAction({
      ...base,
      categoryCounts: { technical_depth: 3 },
    }),
    { allowed: false, reason: "category_limit" },
  );
});

test("finishes before evaluating proposals at the global round limit", () => {
  assert.deepEqual(
    authorizeInterviewAction({ ...base, candidateRoundCount: 20 }),
    { allowed: true, action: "finish", reason: "max_rounds" },
  );
});

test("finishes immediately when the user requests it", () => {
  assert.deepEqual(
    authorizeInterviewAction({ ...base, requestedUserEnd: true }),
    { allowed: true, action: "finish", reason: "user_requested" },
  );
});

test("normalizes case and whitespace when rejecting duplicate questions", () => {
  assert.deepEqual(
    authorizeInterviewAction({
      ...base,
      recentQuestions: ["  WHY   THIS CACHE? "],
      proposal: {
        ...base.proposal,
        question: "why this cache?",
      },
    }),
    { allowed: false, reason: "duplicate_question" },
  );
});

test("requires resume evidence for resume-grounded questions", () => {
  assert.deepEqual(
    authorizeInterviewAction({
      ...base,
      proposal: { ...base.proposal, resumeEvidenceIds: [] },
    }),
    { allowed: false, reason: "missing_evidence" },
  );
});

test("allows a valid follow-up in its original category", () => {
  assert.deepEqual(authorizeInterviewAction(base), {
    allowed: true,
    action: "ask",
  });
});

test("authorizes an agent completion proposal", () => {
  assert.deepEqual(
    authorizeInterviewAction({
      ...base,
      proposal: {
        action: "finish",
        category: "reflection",
        intent: "new_topic",
        resumeEvidenceIds: [],
      },
    }),
    { allowed: true, action: "finish", reason: "agent_completed" },
  );
});
