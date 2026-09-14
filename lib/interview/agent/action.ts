import { z } from "zod";

const levelSchema = z.enum(["low", "medium", "high"]);

export const rootCausePatternSchema = z.enum([
  "none",
  "narrative_hoarding",
  "status_anxiety",
  "conflict_avoidance",
  "surface_framework",
  "story_first_mismatch",
]);

export const answerAnalysisSchema = z.object({
  completeness: levelSchema,
  specificity: levelSchema,
  evidenceStrength: levelSchema,
  reflectionDepth: levelSchema,
  followUpNeeded: z.boolean(),
  missingPoints: z.array(z.string().trim().min(1).max(500)).max(10),
  extractedEvidence: z.array(z.string().trim().min(1).max(500)).max(10),
  rootCausePattern: rootCausePatternSchema.optional(),
  interviewerInnerMonologue: z.string().trim().max(1000).optional(),
}).strict();

export const submitInterviewActionSchema = z.object({
  answerAnalysis: answerAnalysisSchema.nullable(),
  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("ask_question"),
      kind: z.enum(["main", "follow_up"]),
      question: z.string().trim().min(1).max(2_000),
      topic: z.string().trim().min(1).max(100),
      resumeEvidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{16}$/)).max(20),
      tip: z.string().trim().max(500).optional(),
    }).strict(),
    z.object({
      type: z.literal("complete_interview"),
      closingMessage: z.string().trim().min(1).max(2_000),
    }).strict(),
  ]),
}).strict();

export type SubmitInterviewAction = z.infer<typeof submitInterviewActionSchema>;
export type AskQuestionAction = Extract<SubmitInterviewAction["action"], { type: "ask_question" }>;

export function assertOpeningAction(input: SubmitInterviewAction): asserts input is SubmitInterviewAction & {
  answerAnalysis: null;
  action: AskQuestionAction & { kind: "main" };
} {
  if (input.answerAnalysis !== null) throw new Error("Opening action must not include answer analysis");
  if (input.action.type !== "ask_question") throw new Error("Opening action must ask a question");
  if (input.action.kind !== "main") throw new Error("Opening action must ask a main question");
}
