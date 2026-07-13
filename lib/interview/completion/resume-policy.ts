export function getCompletionResumeBlockReason(input: {
  configVersion: number;
  interviewStatus: string;
  hasJob: boolean;
}) {
  if (input.configVersion !== 2) return "Completion resume requires an Agent v2 interview";
  if (!["completing", "scoring", "reporting", "failed", "completed"].includes(input.interviewStatus)) {
    return "Interview is not in a resumable completion state";
  }
  if (!input.hasJob) return "No completion job exists for this interview";
  return null;
}
