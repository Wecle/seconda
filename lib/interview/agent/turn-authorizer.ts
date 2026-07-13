import type {
  AnswerAssessment,
  CoverageStatus,
  InterviewAgentState,
  QuestionCategory,
} from "./contracts";
import {
  authorizeInterviewAction,
  MAX_QUESTIONS_PER_CATEGORY,
  type InterviewAuthorization,
} from "./limits";
import {
  hashTurnProposalPrefix,
  turnProposalPrefixSchema,
  type TurnProposalPrefix,
} from "./turn-proposal";

export type ProjectedTurnState = {
  consecutiveNoFollowUpAssessments: number;
  categoryStatuses: Partial<Record<QuestionCategory, CoverageStatus>>;
};

export type AuthorizedTurnProposal = {
  allowed: true;
  prefix: TurnProposalPrefix;
  proposalHash: string;
  projectedState: ProjectedTurnState;
};

export type RejectedTurnProposal = {
  allowed: false;
  reason:
    | "OPENING_ASSESSMENT_FORBIDDEN"
    | "OPENING_COVERAGE_FORBIDDEN"
    | "ANSWER_ASSESSMENT_REQUIRED"
    | "ANSWER_CATEGORY_REQUIRED"
    | "CONTRADICTORY_COVERAGE_CHANGE"
    | "INVALID_PROPOSAL"
    | "CATEGORY_LIMIT"
    | "DUPLICATE_QUESTION"
    | "MISSING_EVIDENCE"
    | "INVALID_FINISH_REASON"
    | "OPENING_CANNOT_FINISH"
    | "COMPLETION_NOT_READY"
    | "POLICY_REQUIRES_FINISH"
    | "INVALID_ACTION";
};

export type TurnProposalAuthorization =
  | AuthorizedTurnProposal
  | RejectedTurnProposal;

type LimitRejectionReason = Extract<
  InterviewAuthorization,
  { allowed: false }
>["reason"];

const limitRejectionReasonMap: Record<
  LimitRejectionReason,
  RejectedTurnProposal["reason"]
> = {
  category_limit: "CATEGORY_LIMIT",
  duplicate_question: "DUPLICATE_QUESTION",
  missing_evidence: "MISSING_EVIDENCE",
  invalid_finish_reason: "INVALID_FINISH_REASON",
  opening_cannot_finish: "OPENING_CANNOT_FINISH",
  completion_not_ready: "COMPLETION_NOT_READY",
  invalid_action: "INVALID_ACTION",
};

export function projectAssessmentCoverage(assessment: AnswerAssessment): {
  depth: number;
  evidenceQuality: number;
  status: "partial" | "sufficient";
} {
  return {
    depth: { low: 1, medium: 2, high: 3 }[assessment.completeness],
    evidenceQuality: { weak: 1, partial: 2, strong: 3 }[
      assessment.evidenceStrength
    ],
    status: assessment.followUpNeeded ? "partial" : "sufficient",
  };
}

export function authorizeTurnProposal(input: {
  state: InterviewAgentState;
  mode: "opening" | "answer";
  answerCategory: QuestionCategory | null;
  prefix: unknown;
  responseText?: string;
}): TurnProposalAuthorization {
  const parsedPrefix = turnProposalPrefixSchema.safeParse(input.prefix);
  if (!parsedPrefix.success) {
    return { allowed: false, reason: "INVALID_PROPOSAL" };
  }

  if (input.mode === "opening") {
    if (parsedPrefix.data.assessment !== null) {
      return { allowed: false, reason: "OPENING_ASSESSMENT_FORBIDDEN" };
    }
    if (parsedPrefix.data.coverageChanges.length > 0) {
      return { allowed: false, reason: "OPENING_COVERAGE_FORBIDDEN" };
    }
  } else {
    if (parsedPrefix.data.assessment === null) {
      return { allowed: false, reason: "ANSWER_ASSESSMENT_REQUIRED" };
    }
    if (input.answerCategory === null) {
      return { allowed: false, reason: "ANSWER_CATEGORY_REQUIRED" };
    }
  }

  const projectedStateResult = projectTurnState(input.state, {
    assessment: parsedPrefix.data.assessment,
    answerCategory: input.answerCategory,
    coverageChanges: parsedPrefix.data.coverageChanges,
  });
  if (!projectedStateResult.ok) {
    return { allowed: false, reason: "CONTRADICTORY_COVERAGE_CHANGE" };
  }

  const prefix = turnProposalPrefixSchema.parse({
    ...parsedPrefix.data,
    coverageChanges: projectedStateResult.normalizedCoverageChanges,
  });

  const decision = prefix.decision;
  const authorization = authorizeInterviewAction({
    candidateRoundCount: input.state.candidateRoundCount,
    categoryCounts: input.state.categoryCounts,
    recentQuestions: input.state.recentQuestions,
    requestedUserEnd: input.state.requestedUserEnd,
    categoryStatuses: projectedStateResult.projectedState.categoryStatuses,
    consecutiveNoFollowUpAssessments:
      projectedStateResult.projectedState.consecutiveNoFollowUpAssessments,
    proposal: decision.action === "finish"
      ? {
          action: "finish",
          category: input.answerCategory ?? "introduction",
          intent: "new_topic",
          resumeEvidenceIds: [],
          finishReason: decision.completionReason,
        }
      : {
          action: decision.action,
          category: decision.category,
          intent: decision.intent,
          question: input.responseText ?? decision.coverageTarget,
          resumeEvidenceIds: decision.evidenceIds,
        },
  });

  if (!authorization.allowed) {
    return {
      allowed: false,
      reason: limitRejectionReasonMap[authorization.reason],
    };
  }

  if (decision.action !== "finish" && authorization.action === "finish") {
    return { allowed: false, reason: "POLICY_REQUIRES_FINISH" };
  }

  if (decision.action === "finish" && authorization.action !== "finish") {
    return { allowed: false, reason: "INVALID_ACTION" };
  }

  return {
    allowed: true,
    prefix,
    proposalHash: hashTurnProposalPrefix(prefix),
    projectedState: projectedStateResult.projectedState,
  };
}

function projectTurnState(
  state: InterviewAgentState,
  input: {
    assessment: AnswerAssessment | null;
    answerCategory: QuestionCategory | null;
    coverageChanges: TurnProposalPrefix["coverageChanges"];
  },
): {
  ok: true;
  projectedState: ProjectedTurnState;
  normalizedCoverageChanges: TurnProposalPrefix["coverageChanges"];
} | { ok: false } {
  const categoryStatuses = { ...state.categoryStatuses };
  let consecutiveNoFollowUpAssessments =
    state.consecutiveNoFollowUpAssessments ?? 0;

  for (const [category, count] of Object.entries(state.categoryCounts)) {
    if ((count ?? 0) >= MAX_QUESTIONS_PER_CATEGORY) {
      categoryStatuses[category as QuestionCategory] = "exhausted";
    }
  }

  let assessmentStatus: "partial" | "sufficient" | null = null;
  if (input.assessment && input.answerCategory) {
    const assessmentCoverage = projectAssessmentCoverage(input.assessment);
    assessmentStatus = assessmentCoverage.status;
    categoryStatuses[input.answerCategory] =
      (state.categoryCounts[input.answerCategory] ?? 0) >=
        MAX_QUESTIONS_PER_CATEGORY
        ? "exhausted"
        : assessmentCoverage.status;
    consecutiveNoFollowUpAssessments = input.assessment.followUpNeeded
      ? 0
      : consecutiveNoFollowUpAssessments + 1;
  }

  const normalizedCoverageChanges: TurnProposalPrefix["coverageChanges"] = [];
  for (const change of input.coverageChanges) {
    const categoryCount = state.categoryCounts[change.category] ?? 0;
    const categoryIsExhausted =
      categoryCount >= MAX_QUESTIONS_PER_CATEGORY;

    if (change.status === "exhausted" && !categoryIsExhausted) {
      return { ok: false };
    }

    if (change.category === input.answerCategory && assessmentStatus) {
      const compatibleWithAssessment = change.status === assessmentStatus
        || (categoryIsExhausted && change.status === "exhausted");
      if (!compatibleWithAssessment) return { ok: false };

      normalizedCoverageChanges.push({
        ...change,
        status: categoryIsExhausted ? "exhausted" : assessmentStatus,
      });
      continue;
    }

    const projectedStatus = categoryStatuses[change.category] ?? "uncovered";
    if (change.status !== projectedStatus) return { ok: false };
    normalizedCoverageChanges.push(change);
  }

  return {
    ok: true,
    normalizedCoverageChanges,
    projectedState: {
      consecutiveNoFollowUpAssessments,
      categoryStatuses,
    },
  };
}
