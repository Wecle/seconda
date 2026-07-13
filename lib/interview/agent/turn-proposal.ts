import { createHash } from "node:crypto";

import { z } from "zod";

import {
  answerAssessmentSchema,
  coverageStatusSchema,
  questionCategorySchema,
} from "./contracts";

const coverageChangeSchema = z.object({
  category: questionCategorySchema,
  topic: z.string().trim().min(1).max(200),
  status: coverageStatusSchema,
  resumeEvidenceIds: z.array(z.string().min(1)).max(20),
}).strict();

const questionDecisionSchema = z.object({
  action: z.enum(["ask", "clarify"]),
  category: questionCategorySchema,
  intent: z.enum(["new_topic", "follow_up", "verify_evidence"]),
  evidenceIds: z.array(z.string().min(1)).max(20),
  coverageTarget: z.string().trim().min(1).max(500),
  estimatedInformationGain: z.enum(["low", "medium", "high"]),
}).strict();

const finishDecisionSchema = z.object({
  action: z.literal("finish"),
  completionReason: z.enum([
    "coverage_sufficient",
    "low_information_gain",
    "user_requested",
    "max_rounds",
  ]),
}).strict();

export const turnProposalPrefixSchema = z.object({
  assessment: answerAssessmentSchema.nullable(),
  coverageChanges: z.array(coverageChangeSchema).max(9),
  decision: z.discriminatedUnion("action", [
    questionDecisionSchema,
    finishDecisionSchema,
  ]),
}).strict();

export const interviewTurnProposalSchema = turnProposalPrefixSchema.extend({
  responseText: z.string().trim().min(1).max(2_000),
}).strict();

export type TurnProposalPrefix = z.infer<typeof turnProposalPrefixSchema>;
export type InterviewTurnProposal = z.infer<typeof interviewTurnProposalSchema>;

export type TurnProposalProgress =
  | { status: "accumulating" }
  | { status: "protocol_violation"; responseText: string }
  | {
    status: "prefix_ready";
    prefix: TurnProposalPrefix;
    responseText: string;
  };

export function readTurnProposalProgress(input: unknown): TurnProposalProgress {
  if (!isRecord(input)) return { status: "accumulating" };

  if (Object.hasOwn(input, "responseText") && typeof input.responseText !== "string") {
    return {
      status: "protocol_violation",
      responseText: "[invalid-response-text]",
    };
  }

  const responseText = typeof input.responseText === "string"
    ? input.responseText
    : "";
  const prefixCandidate = { ...input };
  delete prefixCandidate.responseText;
  const prefixResult = turnProposalPrefixSchema.safeParse(prefixCandidate);

  if (!prefixResult.success) {
    return responseText.trim().length > 0
      ? { status: "protocol_violation", responseText }
      : { status: "accumulating" };
  }

  return {
    status: "prefix_ready",
    prefix: prefixResult.data,
    responseText,
  };
}

export function hashTurnProposalPrefix(prefix: TurnProposalPrefix): string {
  const normalized = turnProposalPrefixSchema.parse(prefix);
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
