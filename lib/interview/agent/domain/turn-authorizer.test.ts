import assert from "node:assert/strict";
import test from "node:test";

import type {
  AnswerAssessment,
  InterviewAgentState,
  QuestionCategory,
} from "@/lib/interview/agent/domain/interview";
import {
  authorizeTurnProposal as authorizeTurnProposalImpl,
  projectAssessmentCoverage,
} from "@/lib/interview/agent/domain/turn-authorizer";
import type { TurnProposalPrefix } from "@/lib/interview/agent/domain/turn-proposal";

function validAssessment(
  overrides: Partial<AnswerAssessment> = {},
): AnswerAssessment {
  return {
    completeness: "high",
    specificity: "medium",
    evidenceStrength: "strong",
    reflectionDepth: "surface",
    followUpNeeded: true,
    missingPoints: ["触发阈值"],
    extractedEvidence: ["30 秒后自动降级"],
    publicSummary: "回答包含明确机制，但触发条件仍需追问。",
    ...overrides,
  };
}

function stateWith(
  overrides: Partial<InterviewAgentState> = {},
): InterviewAgentState {
  return {
    interviewId: "interview-1",
    candidateRoundCount: 4,
    categoryCounts: { technical_depth: 2 },
    recentQuestions: ["请解释你在 Seconda 中的缓存策略。"],
    requestedUserEnd: false,
    categoryStatuses: { technical_depth: "partial" },
    consecutiveNoFollowUpAssessments: 0,
    ...overrides,
  };
}

function askPrefix(input: {
  assessment?: AnswerAssessment | null;
  action?: "ask" | "clarify";
  category?: QuestionCategory;
  coverageChanges?: TurnProposalPrefix["coverageChanges"];
  evidenceIds?: string[];
} = {}): TurnProposalPrefix {
  return {
    assessment: input.assessment === undefined
      ? validAssessment()
      : input.assessment,
    coverageChanges: input.coverageChanges ?? [{
      category: "technical_depth",
      topic: "降级机制",
      status: "partial",
      resumeEvidenceIds: ["evidence-1"],
    }],
    roleResolution: null,
    decision: {
      action: "ask",
      category: input.category ?? "technical_depth",
      intent: "follow_up",
      evidenceIds: input.evidenceIds ?? ["evidence-1"],
      coverageTarget: "验证自动降级的触发条件",
      estimatedInformationGain: "high",
    },
  };
}

function finishPrefix(input: {
  followUpNeeded?: boolean;
  reason?: "coverage_sufficient" | "low_information_gain" | "user_requested" | "max_rounds";
  coverageStatus?: "uncovered" | "partial" | "sufficient" | "exhausted";
} = {}): TurnProposalPrefix {
  const followUpNeeded = input.followUpNeeded ?? false;
  return {
    assessment: validAssessment({ followUpNeeded }),
    coverageChanges: [{
      category: "technical_depth",
      topic: "降级机制",
      status: input.coverageStatus ?? (followUpNeeded ? "partial" : "sufficient"),
      resumeEvidenceIds: ["evidence-1"],
    }],
    roleResolution: null,
    decision: {
      action: "finish",
      completionReason: input.reason ?? "coverage_sufficient",
    },
  };
}

type AuthorizationInput = Parameters<typeof authorizeTurnProposalImpl>[0];

function authorizeTurnProposal(
  input: Omit<AuthorizationInput, "openingStage" | "clarificationAnswer">
    & Partial<Pick<AuthorizationInput, "openingStage" | "clarificationAnswer">>,
) {
  return authorizeTurnProposalImpl({
    openingStage: input.mode === "opening"
      ? "role_resolution"
      : input.mode === "opening_clarification"
        ? "awaiting_role_clarification"
        : "formal_interview",
    clarificationAnswer: null,
    ...input,
  });
}

function inferredOpeningPrefix(): TurnProposalPrefix {
  return {
    assessment: null,
    coverageChanges: [],
    roleResolution: {
      status: "inferred",
      value: "前端工程师",
      confidence: "high",
      resumeEvidenceIds: ["evidence-role"],
    },
    decision: {
      action: "ask",
      category: "introduction",
      intent: "new_topic",
      evidenceIds: ["evidence-role"],
      coverageTarget: "自我介绍",
      estimatedInformationGain: "high",
    },
  };
}

function clarificationOpeningPrefix(): TurnProposalPrefix {
  return {
    assessment: null,
    coverageChanges: [],
    roleResolution: {
      status: "needs_clarification",
      confidence: "low",
      resumeEvidenceIds: [],
    },
    decision: {
      action: "clarify",
      subject: "target_role",
      evidenceIds: [],
      estimatedInformationGain: "high",
    },
  };
}

function confirmedOpeningPrefix(): TurnProposalPrefix {
  return {
    ...inferredOpeningPrefix(),
    roleResolution: {
      status: "confirmed",
      value: "前端工程师",
      confidence: "high",
      resumeEvidenceIds: [],
    },
  };
}

test("authorizes a grounded clarification confirmation", () => {
  const result = authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 0 }),
    openingStage: "awaiting_role_clarification",
    mode: "opening_clarification",
    answerCategory: null,
    clarificationAnswer: "我希望面试前端工程师岗位",
    prefix: confirmedOpeningPrefix(),
  });
  assert.equal(result.allowed, true);
});

test("uses the current assessment for low information gain", () => {
  const result = authorizeTurnProposal({
    state: stateWith({
      candidateRoundCount: 6,
      categoryCounts: {
        introduction: 1,
        resume_project: 2,
        technical_depth: 2,
      },
      consecutiveNoFollowUpAssessments: 1,
    }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({
      followUpNeeded: false,
      reason: "low_information_gain",
    }),
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.projectedState.consecutiveNoFollowUpAssessments, 2);
});

test("resets projected low-information streak when follow-up is needed", () => {
  const result = authorizeTurnProposal({
    state: stateWith({
      candidateRoundCount: 6,
      categoryCounts: {
        introduction: 1,
        resume_project: 2,
        technical_depth: 2,
      },
      consecutiveNoFollowUpAssessments: 3,
    }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({
      followUpNeeded: true,
      reason: "low_information_gain",
    }),
  });

  assert.deepEqual(result, {
    allowed: false,
    reason: "COMPLETION_NOT_READY",
  });
});

test("projects current coverage before coverage-sufficient completion", () => {
  const result = authorizeTurnProposal({
    state: stateWith({
      candidateRoundCount: 6,
      categoryCounts: {
        introduction: 1,
        resume_project: 1,
        technical_depth: 2,
      },
      categoryStatuses: {
        introduction: "sufficient",
        resume_project: "exhausted",
        technical_depth: "partial",
      },
    }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({
      followUpNeeded: false,
      reason: "coverage_sufficient",
      coverageStatus: "sufficient",
    }),
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.projectedState.categoryStatuses.technical_depth, "sufficient");
});

test("forbids an assessment and coverage changes during opening", () => {
  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 0 }),
    mode: "opening",
    answerCategory: null,
    prefix: askPrefix({ assessment: validAssessment() }),
  }), { allowed: false, reason: "OPENING_ASSESSMENT_FORBIDDEN" });

  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 0 }),
    mode: "opening",
    answerCategory: null,
    prefix: askPrefix({ assessment: null }),
  }), { allowed: false, reason: "OPENING_COVERAGE_FORBIDDEN" });
});

test("requires an assessment and answer category after an answer", () => {
  assert.deepEqual(authorizeTurnProposal({
    state: stateWith(),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: askPrefix({ assessment: null, coverageChanges: [] }),
  }), { allowed: false, reason: "ANSWER_ASSESSMENT_REQUIRED" });

  assert.deepEqual(authorizeTurnProposal({
    state: stateWith(),
    mode: "answer",
    answerCategory: null,
    prefix: askPrefix(),
  }), { allowed: false, reason: "ANSWER_CATEGORY_REQUIRED" });
});

test("derives current-category statuses from the assessment", () => {
  const result = authorizeTurnProposal({
    state: stateWith(),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: askPrefix({
      coverageChanges: [
        {
          category: "technical_depth",
          topic: "降级背景",
          status: "partial",
          resumeEvidenceIds: ["evidence-1"],
        },
        {
          category: "technical_depth",
          topic: "降级结果",
          status: "sufficient",
          resumeEvidenceIds: ["evidence-1"],
        },
      ],
    }),
  });
  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.deepEqual(
    result.prefix.coverageChanges.map((change) => change.status),
    ["partial", "partial"],
  );
});

test("ignores non-answer category changes instead of authorizing them", () => {
  const result = authorizeTurnProposal({
    state: stateWith({
      candidateRoundCount: 6,
      categoryCounts: {
        technical_depth: 2,
        resume_project: 1,
        introduction: 1,
      },
      categoryStatuses: {
        technical_depth: "sufficient",
        resume_project: "sufficient",
        introduction: "partial",
      },
    }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: askPrefix({
      coverageChanges: [
        ...askPrefix().coverageChanges,
        {
          category: "introduction",
          topic: "自我介绍",
          status: "exhausted",
          resumeEvidenceIds: ["evidence-2"],
        },
      ],
    }),
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.deepEqual(
    result.prefix.coverageChanges.map((change) => change.category),
    ["technical_depth"],
  );
});

test("projects the current answer category as exhausted at its third question", () => {
  const result = authorizeTurnProposal({
    state: stateWith({
      candidateRoundCount: 6,
      categoryCounts: {
        introduction: 1,
        resume_project: 1,
        technical_depth: 3,
      },
      categoryStatuses: {
        introduction: "sufficient",
        resume_project: "sufficient",
        technical_depth: "partial",
      },
    }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({
      followUpNeeded: true,
      reason: "coverage_sufficient",
      coverageStatus: "partial",
    }),
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.projectedState.categoryStatuses.technical_depth, "exhausted");
  assert.equal(result.prefix.coverageChanges[0]?.status, "exhausted");
});

test("normalizes premature exhaustion to the derived current status", () => {
  const result = authorizeTurnProposal({
    state: stateWith({ categoryCounts: { technical_depth: 2 } }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: askPrefix({
      assessment: validAssessment({ followUpNeeded: true }),
      coverageChanges: [{
        category: "technical_depth",
        topic: "降级机制",
        status: "exhausted",
        resumeEvidenceIds: ["evidence-1"],
      }],
    }),
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.prefix.coverageChanges[0]?.status, "partial");
});

test("drops a proposed next-category status before authorization", () => {
  const result = authorizeTurnProposal({
    state: stateWith({
      categoryStatuses: {
        technical_depth: "partial",
        introduction: "uncovered",
      },
    }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: askPrefix({
      coverageChanges: [{
        category: "introduction",
        topic: "自我介绍",
        status: "partial",
        resumeEvidenceIds: ["evidence-1"],
      }],
    }),
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.deepEqual(result.prefix.coverageChanges, []);
});

test("uses response text for final duplicate-question authorization", () => {
  const prefix = askPrefix();
  const prefixResult = authorizeTurnProposal({
    state: stateWith(),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix,
  });
  assert.equal(prefixResult.allowed, true);

  assert.deepEqual(authorizeTurnProposal({
    state: stateWith(),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix,
    responseText: "请解释你在 Seconda 中的缓存策略。",
  }), { allowed: false, reason: "DUPLICATE_QUESTION" });
});

test("rejects an ask prefix when persisted policy requires finish", () => {
  const prefix = askPrefix();
  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ requestedUserEnd: true }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix,
  }), { allowed: false, reason: "POLICY_REQUIRES_FINISH" });

  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 20 }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix,
  }), { allowed: false, reason: "POLICY_REQUIRES_FINISH" });
});

test("requires a finish reason matching persisted forced-completion state", () => {
  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ requestedUserEnd: true }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({ reason: "max_rounds" }),
  }), { allowed: false, reason: "INVALID_FINISH_REASON" });

  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 20 }),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: finishPrefix({ reason: "max_rounds" }),
  }).allowed, true);
});

test("normalizes the prefix before hashing and projects assessment quality", () => {
  assert.deepEqual(projectAssessmentCoverage(validAssessment()), {
    depth: 3,
    evidenceQuality: 3,
    status: "partial",
  });

  const result = authorizeTurnProposal({
    state: stateWith(),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: {
      ...askPrefix(),
      coverageChanges: [{
        ...askPrefix().coverageChanges[0],
        topic: "  降级机制  ",
      }],
    },
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.prefix.coverageChanges[0]?.topic, "降级机制");
  assert.match(result.proposalHash, /^[a-f0-9]{64}$/);
});

test("opening clarification is allowed without resume evidence", () => {
  const result = authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 0 }),
    mode: "opening",
    answerCategory: null,
    prefix: clarificationOpeningPrefix(),
  });

  assert.equal(result.allowed, true);
});

test("authorizes direct inference and rejects ungrounded confirmation", () => {
  assert.equal(authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 0 }),
    mode: "opening",
    answerCategory: null,
    prefix: inferredOpeningPrefix(),
  }).allowed, true);

  assert.deepEqual(authorizeTurnProposal({
    state: stateWith({ candidateRoundCount: 0 }),
    mode: "opening_clarification",
    answerCategory: null,
    clarificationAnswer: "我希望面试后端工程师岗位",
    prefix: confirmedOpeningPrefix(),
  }), {
    allowed: false,
    reason: "ROLE_CONFIRMATION_NOT_GROUNDED",
  });
});

test("rejects a malformed prefix without throwing", () => {
  assert.deepEqual(authorizeTurnProposal({
    state: stateWith(),
    mode: "answer",
    answerCategory: "technical_depth",
    prefix: { assessment: "not-an-assessment" },
  }), { allowed: false, reason: "INVALID_PROPOSAL" });
});
