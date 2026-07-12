import { z } from "zod";
import { questionCategorySchema } from "./contracts";
import {
  authorizeInterviewAction,
  type InterviewActionInput,
} from "./limits";
import type {
  InterviewToolContext,
  InterviewToolDefinition,
  ToolError,
} from "./tool-pipeline";
import { acknowledgementSchema, groundedClaimsSchema, singleQuestionSchema } from "./grounding";

export const interviewToolNames = [
  "get_resume_evidence",
  "get_interview_history",
  "get_coverage_state",
  "update_coverage",
  "ask_interview_question",
  "finish_interview",
] as const;

export type InterviewToolName = (typeof interviewToolNames)[number];

type ToolHandlers = {
  [Name in InterviewToolName]: (
    input: unknown,
    context: InterviewToolContext,
  ) => Promise<unknown>;
};

export type InterviewToolRegistry = Map<
  InterviewToolName,
  InterviewToolDefinition<unknown, unknown>
>;

const schemas = {
  get_resume_evidence: z.object({ evidenceIds: z.array(z.string().min(1)).min(1).max(10) }).strict(),
  get_interview_history: z.object({ limit: z.number().int().min(1).max(20).default(10) }).strict(),
  get_coverage_state: z.object({}).strict(),
  update_coverage: z.object({
    category: questionCategorySchema,
    topic: z.string().trim().min(1).max(200),
    status: z.enum(["uncovered", "partial", "sufficient", "exhausted"]),
    resumeEvidenceIds: z.array(z.string().min(1)).max(20),
  }).strict(),
  ask_interview_question: z.object({
    action: z.enum(["ask", "clarify"]).default("ask"),
    category: questionCategorySchema,
    intent: z.enum(["new_topic", "follow_up", "verify_evidence"]),
    acknowledgement: acknowledgementSchema,
    question: singleQuestionSchema,
    claims: groundedClaimsSchema,
    topic: z.string().trim().min(1).max(200),
    resumeEvidenceIds: z.array(z.string().min(1)).max(20),
  }).strict(),
  finish_interview: z.object({
    reason: z.enum(["coverage_sufficient", "low_information_gain", "user_requested", "max_rounds"]),
    closingMessage: z.string().trim().min(1).max(2000),
  }).strict(),
} satisfies Record<InterviewToolName, z.ZodType>;

export function createInterviewToolRegistry(options: {
  handlers: ToolHandlers;
  loadActionInput: (
    input: z.infer<typeof schemas.ask_interview_question>,
    context: InterviewToolContext,
  ) => Promise<InterviewActionInput>;
  validateEvidenceIds?: (
    evidenceIds: readonly string[],
    context: InterviewToolContext,
  ) => Promise<string[]>;
  validateGroundedResponse?: (
    input: z.infer<typeof schemas.ask_interview_question>,
    context: InterviewToolContext,
  ) => Promise<string[]>;
}): InterviewToolRegistry {
  return new Map(interviewToolNames.map((name) => {
    const definition: InterviewToolDefinition<unknown, unknown> = {
      name,
      inputSchema: schemas[name],
      normalize: normalizeToolInput,
      async validateBusiness(input, context) {
        if (
          options.validateEvidenceIds &&
          (name === "ask_interview_question" || name === "update_coverage")
        ) {
          const evidenceIds = (input as { resumeEvidenceIds?: unknown }).resumeEvidenceIds;
          if (Array.isArray(evidenceIds)) {
            const missing = await options.validateEvidenceIds(
              evidenceIds.filter((id): id is string => typeof id === "string"),
              context,
            );
            if (missing.length > 0) {
              return {
                code: "EVIDENCE_NOT_FOUND",
                message: `简历证据不存在：${missing.join(", ")}`,
                retryable: true,
                suggestion: "调用 get_resume_evidence 并使用目录中返回的 evidence id。",
              };
            }
          }
        }
        if (name !== "ask_interview_question") return null;
        const questionInput = input as z.infer<typeof schemas.ask_interview_question>;
        if (options.validateGroundedResponse) {
          const unsupported = await options.validateGroundedResponse(questionInput, context);
          if (unsupported.length > 0) {
            return {
              code: "UNSUPPORTED_FACT",
              message: `候选人可见内容包含无来源事实：${unsupported.join("；")}`,
              retryable: true,
              suggestion: "删除无来源陈述，或改成询问句；只引用已加载简历证据或候选人回答原文。",
            };
          }
        }
        const authorization = authorizeInterviewAction(
          await options.loadActionInput(
            questionInput,
            context,
          ),
        );
        if (authorization.allowed && authorization.action === "ask") return null;
        if (authorization.allowed) {
          return {
            code: "INTERVIEW_MUST_FINISH",
            message: "面试已达到结束条件，不能继续提问。",
            retryable: false,
            suggestion: "调用 finish_interview。",
          };
        }
        return authorizationError(authorization.reason);
      },
      async authorize(_input, context) {
        return Boolean(context.interviewId && context.runId);
      },
      execute(input, context) {
        return options.handlers[name](input, context);
      },
    };
    return [name, definition];
  }));
}

function normalizeToolInput<T>(input: T): T {
  return input;
}

function authorizationError(reason: string): ToolError {
  const messages: Record<string, { message: string; suggestion: string }> = {
    category_limit: {
      message: "该题型已达到 3 题上限。",
      suggestion: "选择尚未充分覆盖的题型。",
    },
    duplicate_question: {
      message: "该问题与近期问题重复。",
      suggestion: "切换主题或提出能获得新证据的追问。",
    },
    missing_evidence: {
      message: "问题缺少有效的简历证据引用。",
      suggestion: "先调用 get_resume_evidence，再基于返回的 evidence id 提问。",
    },
    invalid_action: {
      message: "面试行动无效。",
      suggestion: "提交一个单一且完整的问题。",
    },
  };
  const detail = messages[reason] ?? messages.invalid_action;
  return { code: reason.toUpperCase(), ...detail, retryable: false };
}
