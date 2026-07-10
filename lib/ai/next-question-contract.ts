import { z } from "zod";

type QuestionPartial = Partial<{
  question: string;
  topic: string;
  tip: string;
}>;

export function isUsableQuestionPartial(previous: QuestionPartial, partial: QuestionPartial) {
  return (["question", "topic", "tip"] as const).some((field) => {
    const value = partial[field];
    return typeof value === "string" && value.trim().length > 0 && value !== previous[field];
  });
}

export function validateGeneratedQuestion(question: { question: string }) {
  if (!question.question.trim()) {
    throw new z.ZodError([
      { code: "custom", message: "Generated question must not be empty", path: ["question"] },
    ]);
  }
}
