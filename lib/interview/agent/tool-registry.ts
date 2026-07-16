import { z } from "zod";

import type { AgentModelStep } from "./contracts";
import type {
  InterviewToolContext,
  InterviewToolDefinition,
} from "./tool-pipeline";
import { withPublicAnalysis } from "./public-analysis";
import { interviewTurnProposalSchema } from "./turn-proposal";

export const interviewToolNames = [
  "get_resume_evidence",
  "get_interview_history",
  "get_coverage_state",
  "submit_interview_turn",
] as const;

export type InterviewToolName = (typeof interviewToolNames)[number];

type ToolHandlerInputs = {
  get_resume_evidence: z.infer<typeof interviewToolInputSchemas.get_resume_evidence>;
  get_interview_history: z.infer<typeof interviewToolInputSchemas.get_interview_history>;
  get_coverage_state: z.infer<typeof interviewToolInputSchemas.get_coverage_state>;
  submit_interview_turn: z.infer<typeof interviewTurnProposalSchema>;
};

export type InterviewToolHandlers = {
  [Name in InterviewToolName]: (
    input: ToolHandlerInputs[Name],
    context: InterviewToolContext,
  ) => Promise<unknown>;
};

export type InterviewToolRegistry = Map<
  InterviewToolName,
  InterviewToolDefinition<unknown, unknown>
>;

export const interviewToolInputSchemas = {
  get_resume_evidence: z.object({
    evidenceIds: z.array(z.string().min(1)).min(1).max(10),
  }).strict(),
  get_interview_history: z.object({
    limit: z.number().int().min(1).max(20).default(10),
  }).strict(),
  get_coverage_state: z.object({}).strict(),
  submit_interview_turn: interviewTurnProposalSchema,
} satisfies Record<InterviewToolName, z.ZodType>;

export const providerInterviewToolInputSchemas = {
  get_resume_evidence: withPublicAnalysis(
    interviewToolInputSchemas.get_resume_evidence,
    "read",
  ),
  get_interview_history: withPublicAnalysis(
    interviewToolInputSchemas.get_interview_history,
    "read",
  ),
  get_coverage_state: withPublicAnalysis(
    interviewToolInputSchemas.get_coverage_state,
    "read",
  ),
  submit_interview_turn: withPublicAnalysis(
    interviewTurnProposalSchema,
    "terminal",
  ),
} satisfies Record<InterviewToolName, z.ZodType>;

export const publicInterviewToolLabels = {
  get_resume_evidence: "核对简历证据",
  get_interview_history: "回顾面试记录",
  get_coverage_state: "检查能力覆盖度",
} as const;

export function createAgentProviderStepSchema(
  toolNames: readonly InterviewToolName[],
): z.ZodType<AgentModelStep> {
  if (toolNames.length === 0) throw new Error("Agent requires at least one tool");
  const branches = toolNames.map((toolName) => z.object({
    type: z.literal("tool_call"),
    callId: z.string().min(1),
    toolName: z.literal(toolName),
    args: providerInterviewToolInputSchemas[toolName],
  }).strict());
  return z.union(
    branches as unknown as [z.ZodObject, ...z.ZodObject[]],
  ) as unknown as z.ZodType<AgentModelStep>;
}

export function createInterviewToolRegistry(options: {
  handlers: InterviewToolHandlers;
}): InterviewToolRegistry {
  return new Map(interviewToolNames.map((name) => {
    const definition: InterviewToolDefinition<unknown, unknown> = {
      name,
      inputSchema: interviewToolInputSchemas[name],
      normalize: normalizeToolInput,
      async validateBusiness() {
        return null;
      },
      async authorize(_input, context) {
        return Boolean(context.interviewId && context.runId);
      },
      execute(input, context) {
        const handler = options.handlers[name];
        return handler(input as never, context);
      },
    };
    return [name, definition];
  }));
}

function normalizeToolInput<T>(input: T): T {
  return input;
}
