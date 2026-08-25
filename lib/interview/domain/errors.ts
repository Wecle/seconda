export type InterviewErrorCode =
  | "INTERVIEW_IDEMPOTENCY_CONFLICT"
  | "RESUME_VERSION_NOT_FOUND"
  | "RESUME_VERSION_NOT_PARSED"
  | "RESUME_VERSION_INVALID";

export class InterviewApplicationError extends Error {
  constructor(
    readonly code: InterviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InterviewApplicationError";
  }
}
