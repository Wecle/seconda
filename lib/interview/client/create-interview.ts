import type { CreateInterviewRequest } from "@/lib/interview/domain/create-interview";

export type InterviewCreationResponse = {
  interviewId: string;
  status: "active";
  replayed: boolean;
  question: {
    id: string;
    sequence: number;
    kind: "main" | "follow_up";
    topic: string;
    question: string;
    tip: string | null;
    resumeEvidenceIds: string[];
  };
};

export class InterviewCreationClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "InterviewCreationClientError";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type InterviewCreationAttempt = {
  signature: string;
  idempotencyKey: string;
};

export type TargetRoleValidationError = "required" | "too_long" | null;

export function validateInterviewTargetRole(value: string): TargetRoleValidationError {
  const length = value.trim().length;
  if (length === 0) return "required";
  return length > 100 ? "too_long" : null;
}

export function resolveInterviewCreationAttempt(input: {
  previous: InterviewCreationAttempt | null;
  request: CreateInterviewRequest;
  createKey: () => string;
}): InterviewCreationAttempt {
  const signature = JSON.stringify(input.request);
  if (input.previous?.signature === signature) return input.previous;
  return { signature, idempotencyKey: input.createKey() };
}

export function resetInterviewCreationAttempt(): null {
  return null;
}

function isCreationResponse(value: unknown): value is InterviewCreationResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  if (!response.question || typeof response.question !== "object") return false;
  const question = response.question as Record<string, unknown>;
  return typeof response.interviewId === "string"
    && response.status === "active"
    && typeof response.replayed === "boolean"
    && typeof question.id === "string"
    && Number.isSafeInteger(question.sequence)
    && (question.sequence as number) > 0
    && (question.kind === "main" || question.kind === "follow_up")
    && typeof question.topic === "string"
    && typeof question.question === "string"
    && (question.tip === null || typeof question.tip === "string")
    && Array.isArray(question.resumeEvidenceIds)
    && question.resumeEvidenceIds.every((id) => typeof id === "string");
}

export async function requestInterviewCreation(input: {
  idempotencyKey: string;
  request: CreateInterviewRequest;
  fetcher?: Fetcher;
}): Promise<InterviewCreationResponse> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("/api/interviews", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(input.request),
  });
  const body = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body
      && typeof body.error === "string"
      ? body.error
      : "INTERVIEW_CREATION_FAILED";
    throw new InterviewCreationClientError(code, response.status);
  }
  if (!isCreationResponse(body)) {
    throw new InterviewCreationClientError("INVALID_INTERVIEW_RESPONSE", response.status);
  }
  return body;
}
