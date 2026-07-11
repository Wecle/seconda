import type { AgentExitReason } from "./contracts";
import { AgentLoopDetector } from "./loop-detector";
import type {
  AgentRuntimeMessage,
  InterviewAgentModelPort,
} from "./model-port";
import type { InterviewAgentRepository } from "./repository";
import {
  executeInterviewTool,
  type InterviewToolDefinition,
  type ToolPipelineHook,
} from "./tool-pipeline";

const MAX_MODEL_TURNS = 8;
const TERMINAL_TOOLS = new Set([
  "ask_interview_question",
  "finish_interview",
]);

export async function runInterviewAgent(options: {
  interviewId: string;
  runId: string;
  repository: InterviewAgentRepository;
  model: InterviewAgentModelPort;
  tools: ReadonlyMap<string, InterviewToolDefinition<unknown, unknown>>;
  hooks?: readonly ToolPipelineHook[];
  initialMessages: readonly AgentRuntimeMessage[];
  signal: AbortSignal;
  progressHash: () => string;
  promptContext?: {
    stablePrefix: string;
    incrementalTail: string;
  };
}): Promise<{ exitReason: AgentExitReason; turnCount: number }> {
  const messages = [...options.initialMessages];
  const loopDetector = new AgentLoopDetector();
  let lastEventSequence = 0;
  let toolCallCount = 0;

  lastEventSequence = (await options.repository.appendEvent(options.runId, {
    type: "run_started",
    payload: { interviewId: options.interviewId },
  })).sequence;

  for (let turn = 1; turn <= MAX_MODEL_TURNS; turn += 1) {
    if (options.signal.aborted) {
      return failRun(options, "aborted_streaming", options.signal.reason, turn - 1);
    }

    await options.repository.saveCheckpoint(options.runId, {
      turnCount: turn - 1,
      toolCallCount,
      lastEventSequence,
      progressHash: options.progressHash(),
      activeSkillNames: [],
    });
    lastEventSequence = (await options.repository.appendEvent(options.runId, {
      type: "model_started",
      payload: { turn },
    })).sequence;

    let step;
    let provisionalMessageId: string | undefined;
    try {
      const modelInput = {
        runId: options.runId,
        messages,
        tools: [...options.tools.keys()].map((name) => ({
          name,
          description: describeTool(name),
        })),
        signal: options.signal,
        promptContext: options.promptContext,
      };
      if (options.model.nextStepStream) {
        const streamed = await options.model.nextStepStream({
          ...modelInput,
          onAttemptStarted: async (attempt) => {
            await options.repository.startAttempt(options.runId, {
              ...attempt,
              now: new Date(),
            });
          },
          onProviderProgress: async () => {
            await options.repository.recordProviderProgress(options.runId, new Date());
          },
          onProvisionalDelta: async (delta) => {
            provisionalMessageId = delta.messageId;
            lastEventSequence = (await options.repository.appendEvent(options.runId, {
              type: "text_delta",
              payload: {
                ...delta,
                provisional: true,
              },
            })).sequence;
          },
        });
        step = streamed.step;
        provisionalMessageId = streamed.provisionalMessageId ?? provisionalMessageId;
      } else {
        step = await options.model.nextStep(modelInput);
      }
    } catch (error) {
      return failRun(options, "aborted_streaming", error, turn);
    }

    if (step.type === "final") {
      messages.push({
        role: "system",
        content:
          "最终文本不会直接展示给候选人。请调用 ask_interview_question 或 finish_interview。",
      });
      continue;
    }

    toolCallCount += 1;
    const definition = options.tools.get(step.toolName);
    if (!definition) {
      const loop = loopDetector.record({
        toolName: step.toolName,
        args: step.args,
        result: { code: "UNKNOWN_TOOL" },
        progressHash: options.progressHash(),
        unknownTool: true,
      });
      messages.push({
        role: "tool",
        content: JSON.stringify({ callId: step.callId, error: "UNKNOWN_TOOL" }),
      });
      const handled = await handleLoopDecision(options, loop, messages);
      if (handled) return { exitReason: handled, turnCount: turn };
      continue;
    }

    const result = await executeInterviewTool({
      definition,
      rawInput: step.args,
      context: {
        interviewId: options.interviewId,
        runId: options.runId,
        repository: options.repository,
        provisionalMessageId,
      },
      hooks: options.hooks,
    });

    if (options.signal.aborted) {
      return failRun(options, "aborted_tools", options.signal.reason, turn);
    }
    if (!result.ok && result.error.code === "HOOK_STOPPED") {
      return failRun(options, "hook_stopped", new Error(result.error.message), turn);
    }

    messages.push({
      role: "tool",
      content: JSON.stringify({ callId: step.callId, toolName: step.toolName, result }),
    });
    const loop = loopDetector.record({
      toolName: step.toolName,
      args: step.args,
      result,
      progressHash: options.progressHash(),
    });
    const handled = await handleLoopDecision(options, loop, messages);
    if (handled) return { exitReason: handled, turnCount: turn };

    if (result.ok && TERMINAL_TOOLS.has(step.toolName)) {
      const committed = readCommittedMessage(result.output);
      if (committed) {
        lastEventSequence = (await options.repository.appendEvent(options.runId, {
          type: "message_committed",
          payload: committed,
        })).sequence;
      }
      lastEventSequence = (await options.repository.appendEvent(options.runId, {
        type: "run_completed",
        payload: { turn, toolName: step.toolName },
      })).sequence;
      await options.repository.saveCheckpoint(options.runId, {
        turnCount: turn,
        toolCallCount,
        lastEventSequence,
        progressHash: options.progressHash(),
        activeSkillNames: [],
      });
      await options.repository.completeRun(options.runId, "completed");
      return { exitReason: "completed", turnCount: turn };
    }
  }

  await options.repository.failRun(
    options.runId,
    "max_turns",
    new Error("Agent reached the model turn limit"),
  );
  return { exitReason: "max_turns", turnCount: MAX_MODEL_TURNS };
}

function readCommittedMessage(output: unknown) {
  if (!output || typeof output !== "object") return null;
  const value = output as { messageId?: unknown; messageSequence?: unknown };
  return typeof value.messageId === "string" &&
    typeof value.messageSequence === "number"
    ? { messageId: value.messageId, messageSequence: value.messageSequence }
    : null;
}

function describeTool(name: string) {
  const descriptions: Record<string, string> = {
    get_resume_evidence:
      '读取简历证据。参数：{"evidenceIds":["从简历证据目录选择的稳定ID"]}。',
    get_interview_history:
      '读取近期面试消息。参数：{"limit":1到20的整数}。',
    get_coverage_state: "读取当前题型覆盖度。参数：{}。",
    record_answer_evaluation:
      '记录回答评估。参数：{"questionId":"UUID","evaluation":任意结构化评估}。',
    update_coverage:
      '更新覆盖度。参数：{"category":题型enum,"topic":"主题","status":"uncovered"|"partial"|"sufficient"|"exhausted","resumeEvidenceIds":["证据ID"]}。',
    ask_interview_question:
      '提交唯一候选人可见问题。参数：{"action":"ask"|"clarify","category":题型enum,"intent":"new_topic"|"follow_up"|"verify_evidence","question":"单一问题","topic":"主题","resumeEvidenceIds":["已加载的稳定证据ID"]}。',
    finish_interview:
      '结束面试。参数：{"reason":"coverage_sufficient"|"low_information_gain"|"user_requested"|"max_rounds","closingMessage":"结束语"}。',
  };
  return descriptions[name] ?? `Seconda interview domain tool: ${name}`;
}

async function handleLoopDecision(
  options: Parameters<typeof runInterviewAgent>[0],
  decision: ReturnType<AgentLoopDetector["record"]>,
  messages: AgentRuntimeMessage[],
): Promise<AgentExitReason | null> {
  if (decision.level === "continue") return null;
  await options.repository.appendEvent(options.runId, {
    type: "warning",
    payload: decision,
  });
  if (decision.level === "warning") {
    messages.push({ role: "system", content: decision.message });
    return null;
  }
  await options.repository.failRun(
    options.runId,
    decision.reason,
    new Error(decision.message),
  );
  return decision.reason;
}

async function failRun(
  options: Parameters<typeof runInterviewAgent>[0],
  reason: AgentExitReason,
  error: unknown,
  turnCount: number,
) {
  await options.repository.failRun(options.runId, reason, error);
  return { exitReason: reason, turnCount };
}
