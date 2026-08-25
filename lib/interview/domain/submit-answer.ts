import { z } from "zod";
import { hashCanonical } from "./create-interview";

export const submitInterviewAnswerRequestSchema = z.object({
  questionId: z.string().uuid(),
  content: z.string().trim().min(1).max(10_000).optional(),
  skipped: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.skipped && value.content !== undefined) {
    context.addIssue({ code: "custom", message: "Skipped answers must not include content", path: ["content"] });
  }
  if (!value.skipped && value.content === undefined) {
    context.addIssue({ code: "custom", message: "Answered submissions require content", path: ["content"] });
  }
});

export const answerSubmissionKeySchema = z.string().trim().min(1).max(200);

export type SubmitInterviewAnswerRequest = z.infer<typeof submitInterviewAnswerRequestSchema>;

export function answerSubmissionRequestHash(input: SubmitInterviewAnswerRequest) {
  return hashCanonical({
    questionId: input.questionId,
    content: input.skipped ? "" : input.content,
    skipped: input.skipped,
  });
}
