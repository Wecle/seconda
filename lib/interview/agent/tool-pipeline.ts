import { z } from "zod";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import type { InterviewAgentRepository } from "./repository";

export type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
  suggestion?: string;
};

export type InterviewToolContext = {
  interviewId: string;
  runId: string;
  repository: InterviewAgentRepository;
};

export interface InterviewToolDefinition<TInput, TOutput> {
  name: string;
  inputSchema: z.ZodType<TInput>;
  normalize(input: TInput): TInput;
  validateBusiness(
    input: TInput,
    context: InterviewToolContext,
  ): Promise<ToolError | null>;
  authorize(
    input: TInput,
    context: InterviewToolContext,
  ): Promise<boolean>;
  execute(input: TInput, context: InterviewToolContext): Promise<TOutput>;
}

type BeforeHookResult =
  | { action: "continue"; input: unknown }
  | { action: "stop"; message: string };
type AfterHookResult =
  | { action: "continue"; output: unknown }
  | { action: "stop"; message: string };

export type ToolPipelineHook =
  | {
      phase: "before";
      run(input: {
        toolName: string;
        input: unknown;
        context: InterviewToolContext;
      }): Promise<BeforeHookResult>;
    }
  | {
      phase: "after";
      run(input: {
        toolName: string;
        input: unknown;
        output: unknown;
        context: InterviewToolContext;
      }): Promise<AfterHookResult>;
    };

export type ToolExecutionResult<TOutput> =
  | { ok: true; output: TOutput }
  | { ok: false; error: ToolError };

export async function executeInterviewTool<TInput, TOutput>(options: {
  definition: InterviewToolDefinition<TInput, TOutput>;
  rawInput: unknown;
  context: InterviewToolContext;
  hooks?: readonly ToolPipelineHook[];
}): Promise<ToolExecutionResult<TOutput>> {
  const parsed = options.definition.inputSchema.safeParse(options.rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_TOOL_INPUT",
        message: "工具参数格式无效。",
        retryable: true,
        suggestion: parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean).join(", "),
      },
    };
  }

  let input = options.definition.normalize(parsed.data);
  const businessError = await options.definition.validateBusiness(
    input,
    options.context,
  );
  if (businessError) return { ok: false, error: businessError };

  for (const hook of options.hooks ?? []) {
    if (hook.phase !== "before") continue;
    const result = await hook.run({
      toolName: options.definition.name,
      input,
      context: options.context,
    });
    if (result.action === "stop") {
      return {
        ok: false,
        error: {
          code: "HOOK_STOPPED",
          message: result.message,
          retryable: false,
        },
      };
    }
    const reparsed = options.definition.inputSchema.safeParse(result.input);
    if (!reparsed.success) {
      return {
        ok: false,
        error: {
          code: "INVALID_HOOK_INPUT",
          message: "前置 Hook 返回了无效参数。",
          retryable: false,
        },
      };
    }
    input = options.definition.normalize(reparsed.data);
  }

  if (!(await options.definition.authorize(input, options.context))) {
    return {
      ok: false,
      error: {
        code: "TOOL_PERMISSION_DENIED",
        message: "当前 Agent Run 无权执行该工具。",
        retryable: false,
      },
    };
  }

  await options.context.repository.appendEvent(options.context.runId, {
    type: "tool_call_started",
    payload: { toolName: options.definition.name, input },
  });

  try {
    let output: unknown = await options.definition.execute(input, options.context);
    for (const hook of options.hooks ?? []) {
      if (hook.phase !== "after") continue;
      const result = await hook.run({
        toolName: options.definition.name,
        input,
        output,
        context: options.context,
      });
      if (result.action === "stop") {
        const error: ToolError = {
          code: "HOOK_STOPPED",
          message: result.message,
          retryable: false,
        };
        await persistToolCompletion(options.context, options.definition.name, {
          ok: false,
          error,
        });
        return { ok: false, error };
      }
      output = result.output;
    }

    const result = { ok: true, output: output as TOutput } as const;
    await persistToolCompletion(options.context, options.definition.name, result);
    return result;
  } catch (error) {
    const sanitized = sanitizeAIError(error);
    const toolError: ToolError = {
      code: "TOOL_EXECUTION_FAILED",
      message: `工具执行失败（${sanitized.category}）。`,
      retryable: sanitized.retryable,
    };
    await persistToolCompletion(options.context, options.definition.name, {
      ok: false,
      error: toolError,
    });
    return { ok: false, error: toolError };
  }
}

function persistToolCompletion(
  context: InterviewToolContext,
  toolName: string,
  result: unknown,
) {
  return context.repository.appendEvent(context.runId, {
    type: "tool_call_completed",
    payload: { toolName, result },
  });
}
