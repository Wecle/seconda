import { createHash } from "node:crypto";

import { z } from "zod";

import {
  answerAssessmentSchema,
  coverageStatusSchema,
  questionCategorySchema,
} from "@/lib/interview/agent/domain/interview";
import { roleResolutionSchema } from "@/lib/interview/agent/domain/opening-role";

export const ANSWER_ASSESSMENT_SCHEMA_DESCRIPTION =
  "回答轮必须提交轻量评估；followUpNeeded=true 时当前回答分类的覆盖状态为 partial，followUpNeeded=false 时为 sufficient；开场必须为 null。";

export const COVERAGE_CHANGES_SCHEMA_DESCRIPTION =
  "通常只为当前回答分类提交主题覆盖变化；状态必须与 assessment.followUpNeeded 推导结果一致，其他分类不得改变聚合状态。";

export const COVERAGE_STATUS_SCHEMA_DESCRIPTION =
  "当前回答分类：followUpNeeded=true 使用 partial，false 使用 sufficient；该分类达到第 3 题时使用 exhausted，未达到时不得提前使用 exhausted。";

const turnAnswerAssessmentSchema = answerAssessmentSchema.describe(
  ANSWER_ASSESSMENT_SCHEMA_DESCRIPTION,
);

const turnCoverageStatusSchema = coverageStatusSchema.describe(
  COVERAGE_STATUS_SCHEMA_DESCRIPTION,
);

const coverageChangeSchema = z.object({
  category: questionCategorySchema,
  topic: z.string().trim().min(1).max(200),
  status: turnCoverageStatusSchema,
  resumeEvidenceIds: z.array(z.string().min(1)).max(20),
}).strict();

const askDecisionSchema = z.object({
  action: z.literal("ask"),
  category: questionCategorySchema,
  intent: z.enum(["new_topic", "follow_up", "verify_evidence"]),
  evidenceIds: z.array(z.string().min(1)).max(20),
  coverageTarget: z.string().trim().min(1).max(500),
  estimatedInformationGain: z.enum(["low", "medium", "high"]),
}).strict();

const roleClarificationDecisionSchema = z.object({
  action: z.literal("clarify"),
  subject: z.literal("target_role"),
  evidenceIds: z.array(z.string().min(1)).max(20),
  estimatedInformationGain: z.enum(["medium", "high"]),
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
  assessment: turnAnswerAssessmentSchema
    .nullable()
    .describe(ANSWER_ASSESSMENT_SCHEMA_DESCRIPTION),
  coverageChanges: z.array(coverageChangeSchema)
    .max(9)
    .describe(COVERAGE_CHANGES_SCHEMA_DESCRIPTION),
  roleResolution: roleResolutionSchema.nullable(),
  decision: z.discriminatedUnion("action", [
    askDecisionSchema,
    roleClarificationDecisionSchema,
    finishDecisionSchema,
  ]),
}).strict();

export const RESPONSE_TEXT_SCHEMA_DESCRIPTION =
  "候选人可见回复，必须作为最后一个字段生成。合法组合：role_resolution 阶段只能是 inferred + introduction ask，或 needs_clarification + target_role clarify；awaiting_role_clarification 阶段只能是 confirmed + introduction ask；formal_interview 阶段 roleResolution 必须为 null 且禁止 clarify。decision.action 为 ask/clarify 时必须围绕唯一核心意图，不得切换主题；finish 时不得邀请继续作答。开场不得枚举或复述简历。";

export const interviewTurnProposalSchema = turnProposalPrefixSchema.extend({
  responseText: z.string()
    .trim()
    .min(1)
    .max(2_000)
    .describe(RESPONSE_TEXT_SCHEMA_DESCRIPTION),
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
