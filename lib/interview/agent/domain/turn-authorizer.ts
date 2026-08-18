import type {
  AnswerAssessment,
  CoverageStatus,
  InterviewAgentState,
  QuestionCategory,
} from "@/lib/interview/agent/domain/interview";
import {
  authorizeInterviewAction,
  MAX_QUESTIONS_PER_CATEGORY,
  type InterviewAuthorization,
} from "@/lib/interview/agent/domain/limits";
import {
  hashTurnProposalPrefix,
  turnProposalPrefixSchema,
  type TurnProposalPrefix,
} from "@/lib/interview/agent/domain/turn-proposal";
import {
  isConfirmedRoleGrounded,
  type AgentRunMode,
  type OpeningStage,
} from "@/lib/interview/agent/domain/opening-role";

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

export type CoverageConflictDetail = {
  category: QuestionCategory;
  topic: string;
  receivedStatus: CoverageStatus;
  expectedStatuses: CoverageStatus[];
  conflictKind:
    | "assessment_status_mismatch"
    | "premature_exhausted"
    | "non_answer_category_change";
};

type NonCoverageRejectionReason = Exclude<
  | "OPENING_ASSESSMENT_FORBIDDEN"
  | "OPENING_COVERAGE_FORBIDDEN"
  | "OPENING_STAGE_MISMATCH"
  | "ROLE_RESOLUTION_REQUIRED"
  | "ROLE_RESOLUTION_FORBIDDEN"
  | "INVALID_OPENING_DECISION"
  | "ROLE_CONFIRMATION_NOT_GROUNDED"
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
  | "INVALID_ACTION",
  "CONTRADICTORY_COVERAGE_CHANGE"
>;

export type RejectedTurnProposal =
  | {
      allowed: false;
      reason: "CONTRADICTORY_COVERAGE_CHANGE";
      detail: CoverageConflictDetail;
    }
  | {
      allowed: false;
      reason: NonCoverageRejectionReason;
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
  NonCoverageRejectionReason
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
  openingStage: OpeningStage;
  mode: AgentRunMode;
  answerCategory: QuestionCategory | null;
  clarificationAnswer: string | null;
  prefix: unknown;
  responseText?: string;
}): TurnProposalAuthorization {
  const parsedPrefix = turnProposalPrefixSchema.safeParse(input.prefix);
  if (!parsedPrefix.success) {
    return { allowed: false, reason: "INVALID_PROPOSAL" };
  }

  const expectedMode: AgentRunMode = input.openingStage === "role_resolution"
    ? "opening"
    : input.openingStage === "awaiting_role_clarification"
      ? "opening_clarification"
      : "answer";
  if (input.mode !== expectedMode) {
    return { allowed: false, reason: "OPENING_STAGE_MISMATCH" };
  }

  const opening = input.openingStage !== "formal_interview";
  if (opening) {
    if (parsedPrefix.data.assessment !== null) {
      return { allowed: false, reason: "OPENING_ASSESSMENT_FORBIDDEN" };
    }
    if (parsedPrefix.data.coverageChanges.length > 0) {
      return { allowed: false, reason: "OPENING_COVERAGE_FORBIDDEN" };
    }
    if (parsedPrefix.data.decision.action === "finish") {
      return { allowed: false, reason: "OPENING_CANNOT_FINISH" };
    }
    if (parsedPrefix.data.roleResolution === null) {
      return { allowed: false, reason: "ROLE_RESOLUTION_REQUIRED" };
    }
  } else {
    if (parsedPrefix.data.roleResolution !== null) {
      return { allowed: false, reason: "ROLE_RESOLUTION_FORBIDDEN" };
    }
    if (parsedPrefix.data.decision.action === "clarify") {
      return { allowed: false, reason: "INVALID_ACTION" };
    }
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
    return {
      allowed: false,
      reason: "CONTRADICTORY_COVERAGE_CHANGE",
      detail: projectedStateResult.detail,
    };
  }

  const prefix = turnProposalPrefixSchema.parse({
    ...parsedPrefix.data,
    coverageChanges: projectedStateResult.normalizedCoverageChanges,
  });

  if (input.openingStage === "role_resolution") {
    const roleResolution = prefix.roleResolution!;
    const directInference = roleResolution.status === "inferred"
      && prefix.decision.action === "ask"
      && prefix.decision.category === "introduction"
      && prefix.decision.intent === "new_topic"
      && roleResolution.resumeEvidenceIds.length > 0
      && prefix.decision.evidenceIds.length > 0;
    const clarification = roleResolution.status === "needs_clarification"
      && prefix.decision.action === "clarify"
      && prefix.decision.subject === "target_role";
    if (!directInference && !clarification) {
      return { allowed: false, reason: directInference === false
        && roleResolution.status === "inferred"
        && prefix.decision.action === "ask"
        && (roleResolution.resumeEvidenceIds.length === 0
          || prefix.decision.evidenceIds.length === 0)
        ? "MISSING_EVIDENCE"
        : "INVALID_OPENING_DECISION" };
    }
    return {
      allowed: true,
      prefix,
      proposalHash: hashTurnProposalPrefix(prefix),
      projectedState: projectedStateResult.projectedState,
    };
  }

  if (input.openingStage === "awaiting_role_clarification") {
    const roleResolution = prefix.roleResolution!;
    const validConfirmation = roleResolution.status === "confirmed"
      && prefix.decision.action === "ask"
      && prefix.decision.category === "introduction"
      && prefix.decision.intent === "new_topic";
    if (!validConfirmation) {
      return { allowed: false, reason: "INVALID_OPENING_DECISION" };
    }
    if (
      !input.clarificationAnswer
      || !isConfirmedRoleGrounded(roleResolution.value, input.clarificationAnswer)
    ) {
      return { allowed: false, reason: "ROLE_CONFIRMATION_NOT_GROUNDED" };
    }
    return {
      allowed: true,
      prefix,
      proposalHash: hashTurnProposalPrefix(prefix),
      projectedState: projectedStateResult.projectedState,
    };
  }

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
      : decision.action === "ask" ? {
          action: decision.action,
          category: decision.category,
          intent: decision.intent,
          question: input.responseText ?? decision.coverageTarget,
          resumeEvidenceIds: decision.evidenceIds,
        } : {
          action: "clarify",
          category: "career_motivation",
          intent: "verify_evidence",
          question: input.responseText,
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
} | { ok: false; detail: CoverageConflictDetail } {
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
    if (change.category !== input.answerCategory || !assessmentStatus) continue;
    const categoryIsExhausted =
      (state.categoryCounts[change.category] ?? 0) >= MAX_QUESTIONS_PER_CATEGORY;
    normalizedCoverageChanges.push({
      ...change,
      status: categoryIsExhausted ? "exhausted" : assessmentStatus,
    });
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
