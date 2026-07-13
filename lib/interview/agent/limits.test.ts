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

test("allows an opening clarification without resume evidence", () => {
  assert.deepEqual(
    authorizeInterviewAction({
      ...base,
      candidateRoundCount: 0,
      proposal: {
        ...base.proposal,
        action: "clarify",
        question: "你希望重点面试前端还是全栈岗位？",
        resumeEvidenceIds: [],
      },
    }),
    { allowed: true, action: "ask" },
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
      candidateRoundCount: 6,
      categoryCounts: {
        technical_depth: 2,
        resume_project: 1,
        problem_solving: 1,
      },
      categoryStatuses: {
        technical_depth: "sufficient",
        resume_project: "exhausted",
        problem_solving: "sufficient",
      },
      proposal: {
        action: "finish",
        category: "reflection",
        intent: "new_topic",
        resumeEvidenceIds: [],
        finishReason: "coverage_sufficient",
      },
    }),
    { allowed: true, action: "finish", reason: "coverage_sufficient" },
  );
});

test("authorizes low information gain only after two consecutive no-follow-up assessments", () => {
  const input: InterviewActionInput = {
    ...base,
    candidateRoundCount: 6,
    categoryCounts: { introduction: 1, resume_project: 2, technical_depth: 2 },
    consecutiveNoFollowUpAssessments: 2,
    proposal: {
      action: "finish",
      category: "reflection",
      intent: "new_topic",
      resumeEvidenceIds: [],
      finishReason: "low_information_gain",
    },
  };
  assert.deepEqual(authorizeInterviewAction(input), {
    allowed: true,
    action: "finish",
    reason: "low_information_gain",
  });
  assert.deepEqual(authorizeInterviewAction({
    ...input,
    consecutiveNoFollowUpAssessments: 1,
  }), { allowed: false, reason: "completion_not_ready" });
});

test("rejects forged finish reasons and opening completion", () => {
  assert.deepEqual(authorizeInterviewAction({
    ...base,
    requestedUserEnd: true,
    proposal: { ...base.proposal, action: "finish", finishReason: "max_rounds" },
  }), { allowed: false, reason: "invalid_finish_reason" });
  assert.deepEqual(authorizeInterviewAction({
    ...base,
    candidateRoundCount: 0,
    proposal: { ...base.proposal, action: "finish", finishReason: "coverage_sufficient" },
  }), { allowed: false, reason: "opening_cannot_finish" });
});
