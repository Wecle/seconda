import type { CoverageStatus, QuestionCategory } from "./contracts";

export const MAX_CANDIDATE_ROUNDS = 20;
export const MAX_QUESTIONS_PER_CATEGORY = 3;

export type InterviewActionProposal = {
  action: "ask" | "finish" | "clarify";
  category: QuestionCategory;
  intent: "new_topic" | "follow_up" | "verify_evidence";
  question?: string;
  resumeEvidenceIds: string[];
  finishReason?: "coverage_sufficient" | "low_information_gain" | "user_requested" | "max_rounds";
};

export type InterviewActionInput = {
  candidateRoundCount: number;
  categoryCounts: Partial<Record<QuestionCategory, number>>;
  recentQuestions: string[];
  requestedUserEnd: boolean;
  categoryStatuses?: Partial<Record<QuestionCategory, CoverageStatus>>;
  consecutiveNoFollowUpAssessments?: number;
  proposal: InterviewActionProposal;
};

export type InterviewAuthorization =
  | { allowed: true; action: "ask" }
  | {
      allowed: true;
      action: "finish";
      reason: "user_requested" | "max_rounds" | "coverage_sufficient" | "low_information_gain";
    }
  | {
      allowed: false;
      reason:
        | "category_limit"
        | "duplicate_question"
        | "missing_evidence"
        | "invalid_finish_reason"
        | "opening_cannot_finish"
        | "completion_not_ready"
        | "invalid_action";
    };

function normalizeQuestion(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function authorizeInterviewAction(
  input: InterviewActionInput,
): InterviewAuthorization {
  if (input.requestedUserEnd) {
    if (
      input.proposal.action === "finish"
      && input.proposal.finishReason !== "user_requested"
    ) return { allowed: false, reason: "invalid_finish_reason" };
    return { allowed: true, action: "finish", reason: "user_requested" };
  }

  if (input.candidateRoundCount >= MAX_CANDIDATE_ROUNDS) {
    if (
      input.proposal.action === "finish"
      && input.proposal.finishReason !== "max_rounds"
    ) return { allowed: false, reason: "invalid_finish_reason" };
    return { allowed: true, action: "finish", reason: "max_rounds" };
  }

  if (input.proposal.action === "finish") {
    if (input.candidateRoundCount === 0) {
      return { allowed: false, reason: "opening_cannot_finish" };
    }
    if (
      input.proposal.finishReason !== "coverage_sufficient"
      && input.proposal.finishReason !== "low_information_gain"
    ) return { allowed: false, reason: "invalid_finish_reason" };
    const touchedCategories = Object.entries(input.categoryCounts)
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([category]) => category as QuestionCategory);
    if (input.candidateRoundCount < 6 || touchedCategories.length < 3) {
      return { allowed: false, reason: "completion_not_ready" };
    }
    if (input.proposal.finishReason === "coverage_sufficient") {
      const complete = touchedCategories.every((category) => {
        const status = input.categoryStatuses?.[category];
        return status === "sufficient" || status === "exhausted";
      });
      return complete
        ? { allowed: true, action: "finish", reason: "coverage_sufficient" }
        : { allowed: false, reason: "completion_not_ready" };
    }
    return (input.consecutiveNoFollowUpAssessments ?? 0) >= 2
      ? { allowed: true, action: "finish", reason: "low_information_gain" }
      : { allowed: false, reason: "completion_not_ready" };
  }

  if (
    input.proposal.action !== "ask" &&
    input.proposal.action !== "clarify"
  ) {
    return { allowed: false, reason: "invalid_action" };
  }

  const question = input.proposal.question?.trim();
  if (!question) {
    return { allowed: false, reason: "invalid_action" };
  }

  if (
    (input.categoryCounts[input.proposal.category] ?? 0) >=
    MAX_QUESTIONS_PER_CATEGORY
  ) {
    return { allowed: false, reason: "category_limit" };
  }

  const normalizedQuestion = normalizeQuestion(question);
  if (
    input.recentQuestions.some(
      (recent) => normalizeQuestion(recent) === normalizedQuestion,
    )
  ) {
    return { allowed: false, reason: "duplicate_question" };
  }

  if (
    input.proposal.action !== "clarify"
    && input.proposal.resumeEvidenceIds.length === 0
  ) {
    return { allowed: false, reason: "missing_evidence" };
  }

  return { allowed: true, action: "ask" };
}
