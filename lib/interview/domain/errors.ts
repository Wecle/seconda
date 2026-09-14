export type InterviewErrorCode =
  | "INTERVIEW_IDEMPOTENCY_CONFLICT"
  | "RESUME_VERSION_NOT_FOUND"
  | "RESUME_VERSION_NOT_PARSED"
  | "RESUME_VERSION_INVALID"
  | "JOB_DESCRIPTION_NOT_FOUND"
  | "INTERVIEW_NOT_FOUND"
  | "INTERVIEW_SUBMISSION_CONFLICT"
  | "INTERVIEW_INVALID_STATE"
  | "INVALID_REPORT_DATA";

export class InterviewApplicationError extends Error {
  constructor(
    readonly code: InterviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InterviewApplicationError";
  }
}
