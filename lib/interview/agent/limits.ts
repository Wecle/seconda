import type { QuestionCategory } from "./contracts";

export const MAX_CANDIDATE_ROUNDS = 20;
export const MAX_QUESTIONS_PER_CATEGORY = 3;

export type InterviewActionProposal = {
  action: "ask" | "finish" | "clarify";
  category: QuestionCategory;
  intent: "new_topic" | "follow_up" | "verify_evidence";
  question?: string;
  resumeEvidenceIds: string[];
};

export type InterviewActionInput = {
  candidateRoundCount: number;
  categoryCounts: Partial<Record<QuestionCategory, number>>;
  recentQuestions: string[];
  requestedUserEnd: boolean;
  proposal: InterviewActionProposal;
};

export type InterviewAuthorization =
  | { allowed: true; action: "ask" }
  | {
      allowed: true;
      action: "finish";
      reason: "user_requested" | "max_rounds" | "agent_completed";
    }
  | {
      allowed: false;
      reason:
        | "category_limit"
        | "duplicate_question"
        | "missing_evidence"
        | "invalid_action";
    };

function normalizeQuestion(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function authorizeInterviewAction(
  input: InterviewActionInput,
): InterviewAuthorization {
  if (input.requestedUserEnd) {
    return { allowed: true, action: "finish", reason: "user_requested" };
  }

  if (input.candidateRoundCount >= MAX_CANDIDATE_ROUNDS) {
    return { allowed: true, action: "finish", reason: "max_rounds" };
  }

  if (input.proposal.action === "finish") {
    return { allowed: true, action: "finish", reason: "agent_completed" };
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

  if (input.proposal.resumeEvidenceIds.length === 0) {
    return { allowed: false, reason: "missing_evidence" };
  }

  return { allowed: true, action: "ask" };
}
