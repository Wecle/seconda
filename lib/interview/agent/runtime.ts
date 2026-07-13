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
import type { InterviewSkill } from "./skills";
import { renderSkillInstructions } from "./skills";
import { publicArtifactFromToolCompletion } from "./public-events";

const MAX_MODEL_TURNS = 8;
const MAX_TOOL_REPAIR_TURNS = 2;
const MAX_PROVIDER_CALLS = MAX_MODEL_TURNS + MAX_TOOL_REPAIR_TURNS;
const MAX_PROVIDER_ATTEMPTS = 10;
const REPAIRABLE_TOOL_ERRORS = new Set([
  "INVALID_TOOL_INPUT",
  "EVIDENCE_NOT_FOUND",
  "SOURCE_NOT_FOUND",
]);
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
  activeSkills?: readonly InterviewSkill[];
  phaseProgressId?: string;
  publicThinkingSummary?: string;
  thinkingAlreadyStarted?: boolean;
  promptContext?: {
    stablePrefix: string;
    incrementalTail: string;
  };
}): Promise<{ exitReason: AgentExitReason; turnCount: number }> {
  const messages = [...options.initialMessages];
  if (options.activeSkills?.length) {
    messages.unshift({ role: "system", content: renderSkillInstructions(options.activeSkills) });
  }
  const loopDetector = new AgentLoopDetector();
  let lastEventSequence = 0;
  let toolCallCount = 0;
  let productiveTurnCount = 0;
  let repairTurnCount = 0;
  let providerAttemptCount = 0;

  lastEventSequence = (await options.repository.appendEvent(options.runId, {
    type: "run_started",
    payload: { interviewId: options.interviewId },
  })).sequence;
  if (!options.thinkingAlreadyStarted) {
    lastEventSequence = (await options.repository.appendEvent(options.runId, {
      type: "thinking_started",
      payload: { runId: options.runId },
    })).sequence;
  }
  if (options.publicThinkingSummary) {
    lastEventSequence = (await options.repository.appendEvent(options.runId, {
      type: "thinking_summary",
      payload: {
        runId: options.runId,
        entryId: `assessment:${options.phaseProgressId ?? options.runId}`,
        stage: "assessment",
        summary: options.publicThinkingSummary,
      },
    })).sequence;
  }

  for (
    let providerCall = 1;
    providerCall <= MAX_PROVIDER_CALLS && productiveTurnCount < MAX_MODEL_TURNS;
    providerCall += 1
  ) {
    if (options.signal.aborted) {
      return failRun(options, "aborted_streaming", options.signal.reason, productiveTurnCount);
    }

    await options.repository.saveCheckpoint(options.runId, {
      turnCount: productiveTurnCount,
      toolCallCount,
      lastEventSequence,
      progressHash: options.progressHash(),
      activeSkillNames: options.activeSkills?.map((skill) => skill.name) ?? [],
      phase: "planning",
      phaseProgressId: options.phaseProgressId,
    });
    lastEventSequence = (await options.repository.appendEvent(options.runId, {
      type: "model_started",
      payload: {
        turn: providerCall,
        attemptedProductiveTurn: productiveTurnCount + 1,
        repairAttemptsUsed: repairTurnCount,
      },
    })).sequence;

    let step;
    let provisionalMessageId: string | undefined;
    let selectedAttemptId: string | undefined;
    const bufferedDeltas: Array<{ messageId: string; attemptId: string; text: string }> = [];
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
            providerAttemptCount += 1;
            if (providerAttemptCount > MAX_PROVIDER_ATTEMPTS) {
              throw Object.assign(new Error("Agent reached the provider attempt limit"), {
                code: "PROVIDER_ATTEMPT_LIMIT",
              });
            }
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
            bufferedDeltas.push(delta);
          },
        });
        step = streamed.step;
        selectedAttemptId = streamed.attemptId;
        provisionalMessageId = streamed.provisionalMessageId ?? provisionalMessageId;
      } else {
        step = await options.model.nextStep(modelInput);
      }
    } catch (error) {
      if ((error as { code?: unknown })?.code === "PROVIDER_ATTEMPT_LIMIT") {
        return failRun(options, "max_turns", error, productiveTurnCount);
      }
      return failRun(options, "aborted_streaming", error, productiveTurnCount);
    }

    if (step.type === "final") {
      productiveTurnCount += 1;
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
        phase: "planning",
        phaseProgressId: options.phaseProgressId,
      });
      messages.push({
        role: "tool",
        content: JSON.stringify({ callId: step.callId, error: "UNKNOWN_TOOL" }),
      });
      const handled = await handleLoopDecision(options, loop, messages);
      productiveTurnCount += 1;
      if (handled) return { exitReason: handled, turnCount: productiveTurnCount };
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
      return failRun(options, "aborted_tools", options.signal.reason, productiveTurnCount);
    }
    if (!result.ok && result.error.code === "HOOK_STOPPED") {
      return failRun(options, "hook_stopped", new Error(result.error.message), productiveTurnCount);
    }

    const repairableFailure = !result.ok &&
      result.error.retryable &&
      REPAIRABLE_TOOL_ERRORS.has(result.error.code);
    if (repairableFailure) repairTurnCount += 1;
    else productiveTurnCount += 1;

    messages.push({
      role: "tool",
      content: JSON.stringify({ callId: step.callId, toolName: step.toolName, result }),
    });
    const loop = loopDetector.record({
      toolName: step.toolName,
      args: step.args,
      result,
      progressHash: options.progressHash(),
      phase: TERMINAL_TOOLS.has(step.toolName) ? "acting" : "planning",
      phaseProgressId: options.phaseProgressId,
    });
    if (result.ok) {
      const artifact = publicArtifactFromToolCompletion({
        toolName: step.toolName,
        runId: options.runId,
        callId: step.callId,
      });
      if (artifact) {
        lastEventSequence = (await options.repository.appendEvent(options.runId, {
          type: "artifact_committed",
          payload: artifact,
        })).sequence;
      }
    }
    const handled = await handleLoopDecision(options, loop, messages);
    if (handled) return { exitReason: handled, turnCount: productiveTurnCount };
    if (repairTurnCount > MAX_TOOL_REPAIR_TURNS) {
      return failRun(
        options,
        "blocking_limit",
        new Error("Agent exhausted the tool argument repair budget"),
        productiveTurnCount,
      );
    }

    if (result.ok && TERMINAL_TOOLS.has(step.toolName)) {
      const committed = readCommittedMessage(result.output);
      if (committed) {
        const publicDeltas = committed.responseText
          ? chunkResponse(committed.responseText).map((text) => ({
              messageId: committed.messageId,
              attemptId: selectedAttemptId ?? `response:${options.runId}`,
              text,
            }))
          : bufferedDeltas.filter((delta) => delta.attemptId === selectedAttemptId);
        if (publicDeltas.length > 0) {
          lastEventSequence = (await options.repository.appendEvent(options.runId, {
            type: "response_started",
            payload: { runId: options.runId, messageId: committed.messageId },
          })).sequence;
          for (const delta of publicDeltas) {
            lastEventSequence = (await options.repository.appendEvent(options.runId, {
              type: "text_delta",
              payload: { ...delta, runId: options.runId, provisional: true },
            })).sequence;
          }
        }
        lastEventSequence = (await options.repository.appendEvent(options.runId, {
          type: "message_committed",
          payload: { ...committed, runId: options.runId },
        })).sequence;
      }
      await options.repository.saveCheckpoint(options.runId, {
        turnCount: productiveTurnCount,
        toolCallCount,
        lastEventSequence,
        progressHash: options.progressHash(),
        activeSkillNames: options.activeSkills?.map((skill) => skill.name) ?? [],
        phase: "acting",
        phaseProgressId: options.phaseProgressId,
      });
      await options.repository.terminateRun(options.runId, { exitReason: "completed" });
      return { exitReason: "completed", turnCount: productiveTurnCount };
    }
  }

  await options.repository.terminateRun(options.runId, {
    exitReason: "max_turns",
    error: new Error("Agent reached the model turn limit"),
  });
  return { exitReason: "max_turns", turnCount: productiveTurnCount };
}

function chunkResponse(value: string) {
  return value.match(/[\s\S]{1,12}/g) ?? [];
}

function readCommittedMessage(output: unknown) {
  if (!output || typeof output !== "object") return null;
  const value = output as { messageId?: unknown; messageSequence?: unknown; responseText?: unknown };
  return typeof value.messageId === "string" &&
    typeof value.messageSequence === "number"
    ? { messageId: value.messageId, messageSequence: value.messageSequence, responseText: typeof value.responseText === "string" ? value.responseText : null }
    : null;
}

function describeTool(name: string) {
  const descriptions: Record<string, string> = {
    get_resume_evidence:
      '读取简历证据。参数：{"evidenceIds":["从简历证据目录选择的稳定ID"]}。',
    get_interview_history:
      '读取近期面试消息。参数：{"limit":1到20的整数}。',
    get_coverage_state: "读取当前题型覆盖度。参数：{}。",
    update_coverage:
      '更新覆盖度。参数：{"category":题型enum,"topic":"主题","status":"uncovered"|"partial"|"sufficient"|"exhausted","resumeEvidenceIds":["证据ID"]}。',
    ask_interview_question:
      '提交候选人可见的评价与唯一问题。参数：{"action":"ask"|"clarify","category":题型enum,"intent":"new_topic"|"follow_up"|"verify_evidence","acknowledgement":"1到3句基于来源的评价；开场可为空","question":"只含一个问号的单一问题","claims":[{"text":"评价中的原文事实","sourceIds":["简历证据ID或answer:消息ID"]}],"topic":"主题","resumeEvidenceIds":["已加载的稳定证据ID"]}。sourceIds 只能写入 claims，禁止出现在候选人可见文本中；无法确认的事实必须改成询问句。',
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
  await options.repository.terminateRun(options.runId, {
    exitReason: decision.reason,
    error: new Error(decision.message),
    userMessage: decision.message,
  });
  return decision.reason;
}

async function failRun(
  options: Parameters<typeof runInterviewAgent>[0],
  reason: AgentExitReason,
  error: unknown,
  turnCount: number,
) {
  await options.repository.terminateRun(options.runId, { exitReason: reason, error });
  return { exitReason: reason, turnCount };
}
