import { isDeepStrictEqual } from "node:util";

import type {
  AgentCheckpoint,
  AgentExitReason,
  AgentModelStep,
  PublicAgentEventType,
  QuestionCategory,
} from "./contracts";
import {
  publicAgentEventPayloadSchemas,
  publicAgentEventTypes,
} from "./contracts";
import { createEventCoalescer, type EventCoalescer } from "./event-coalescer";
import type {
  AgentModelStreamEvent,
  AgentRuntimeMessage,
  InterviewAgentModelPort,
} from "./model-port";
import type {
  AgentRunPhase,
  InterviewAgentRepository,
  RunLeaseToken,
} from "./repository";
import {
  validateFinalResponse,
  validateResponseProgress,
} from "./response-validator";
import { createSafeTailBuffer, type SafeTailBuffer } from "./safe-tail-buffer";
import {
  executeInterviewTool,
  type BeforeToolPipelineHook,
  type InterviewToolDefinition,
} from "./tool-pipeline";
import {
  publicInterviewToolLabels,
} from "./tool-registry";
import {
  authorizeTurnProposal,
  type AuthorizedTurnProposal,
} from "./turn-authorizer";
import {
  hashTurnProposalPrefix,
  interviewTurnProposalSchema,
  readTurnProposalProgress,
} from "./turn-proposal";
import type { InterviewSkill } from "./skills";
import { renderSkillInstructions } from "./skills";
import { AgentLoopDetector, type LoopDecision } from "./loop-detector";
import {
  MAX_INVALID_MODEL_ACTIONS,
  MAX_PLANNING_STEPS,
  MAX_TERMINAL_ATTEMPTS,
  isTerminalTool,
} from "./runtime-policy";

export type TurnRuntimeContext = {
  mode: "opening" | "answer";
  answerCategory: QuestionCategory | null;
  answerMessageId: string | null;
  language: "zh" | "en" | "es" | "de";
  persona: "friendly" | "standard" | "stressful";
  allowedTerms: readonly string[];
};

type AttemptState = {
  attemptId: string;
  logicalMessageId: string;
  attemptNumber: number;
  reasoning: EventCoalescer;
  response: EventCoalescer;
  reasoningDeltaCount: number;
  observedReasoningText: string;
  reasoningTail: SafeTailBuffer;
  reasoningStarted: boolean;
  responseDeltaCount: number;
  publicReadTools: Set<string>;
  terminalToolCallId: string | null;
  terminalSeen: boolean;
  authorized: AuthorizedTurnProposal | null;
  responseStarted: boolean;
  observedResponseText: string;
  responseTail: SafeTailBuffer;
};

type FailureAccountingKind = "terminal" | "invalid" | "unknown" | "provider";

type RunOptions = {
  interviewId: string;
  runId: string;
  repository: InterviewAgentRepository;
  model: InterviewAgentModelPort;
  tools: ReadonlyMap<string, InterviewToolDefinition<unknown, unknown>>;
  hooks?: readonly BeforeToolPipelineHook[];
  initialMessages: readonly AgentRuntimeMessage[];
  signal: AbortSignal;
  lease: RunLeaseToken;
  progressHash: () => string;
  activeSkills?: readonly InterviewSkill[];
  promptContext?: {
    stablePrefix: string;
    incrementalTail: string;
  };
  turnContext: TurnRuntimeContext;
};

const publicEventTypeSet = new Set<string>(publicAgentEventTypes);
const REASONING_SAFE_TAIL_CHARACTERS = 64;
const RESPONSE_SAFE_TAIL_CHARACTERS = 32;

export async function runInterviewAgent(
  options: RunOptions,
): Promise<{ exitReason: AgentExitReason; turnCount: number }> {
  const persistedRun = await options.repository.getRun(options.runId);
  const checkpoint = persistedRun?.checkpoint;
  const persistedEvents = await options.repository.listEvents(options.runId, 0);

  const messages = checkpoint?.runtimeMessages
    ? [...checkpoint.runtimeMessages]
    : [...options.initialMessages];
  if (!checkpoint?.runtimeMessages && options.activeSkills?.length) {
    messages.unshift({
      role: "system",
      content: renderSkillInstructions(options.activeSkills),
    });
  }

  const context = options.turnContext;
  let lastEventSequence = Math.max(
    checkpoint?.lastEventSequence ?? 0,
    persistedRun?.lastEventSequence ?? 0,
  );
  let planningStepCount = checkpoint?.turnCount ?? 0;
  let toolCallCount = checkpoint?.toolCallCount ?? 0;
  let modelCallCount = checkpoint?.modelCallCount ?? 0;
  let terminalAttemptCount = checkpoint?.terminalAttemptCount ?? 0;
  let invalidModelActionCount = checkpoint?.invalidModelActionCount ?? 0;
  let unknownModelActionCount = checkpoint?.unknownModelActionCount ?? 0;
  let lastFailureAccounting = checkpoint?.lastFailureAccounting ?? null;
  const loopDetector = new AgentLoopDetector(checkpoint?.loopDetector);
  const phaseProgressId = checkpoint?.phaseProgressId
    ?? context.answerMessageId
    ?? "opening";
  let attemptNumberOffset = persistedRun?.attemptNumber ?? 0;
  let logicalMessageId: string | null = persistedRun?.provisionalMessageId ?? null;
  let currentAttempt: AttemptState | null = null;
  let publicWriteCount = 0;

  async function appendPublicEvent(
    type: PublicAgentEventType,
    payload: unknown,
    identity: { attemptId: string | null; logicalMessageId: string | null },
    dedupeKey?: string,
  ) {
    if (!publicEventTypeSet.has(type)) {
      throw new Error(`Runtime cannot publish internal event type: ${type}`);
    }
    const schema = publicAgentEventPayloadSchemas[type] as {
      parse(value: unknown): unknown;
    };
    const parsedPayload = schema.parse(payload);
    const event = await options.repository.appendEvent(options.runId, {
      type,
      visibility: "public",
      attemptId: identity.attemptId,
      logicalMessageId: identity.logicalMessageId,
      payload: parsedPayload,
      dedupeKey,
    }, options.lease);
    lastEventSequence = Math.max(lastEventSequence, event.sequence);
    publicWriteCount += 1;
    return event;
  }

  async function appendPhase(
    phase: AgentRunPhase,
    attempt: AttemptState | null,
  ) {
    await appendPublicEvent("phase_changed", {
      runId: options.runId,
      attemptId: attempt?.attemptId ?? null,
      phase,
    }, {
      attemptId: attempt?.attemptId ?? null,
      logicalMessageId: attempt?.logicalMessageId ?? logicalMessageId,
    }, `phase:${attempt?.attemptId ?? "run"}:${phase}:${lastEventSequence + 1}`);
  }

  function checkpointFor(
    phase: Exclude<AgentRunPhase, "scoring" | "reporting">,
    pendingToolCall?: AgentCheckpoint["pendingToolCall"],
  ): AgentCheckpoint {
    return {
      turnCount: planningStepCount,
      toolCallCount,
      lastEventSequence,
      progressHash: options.progressHash(),
      activeSkillNames: options.activeSkills?.map((skill) => skill.name) ?? [],
      phase,
      terminalAttemptCount,
      modelCallCount,
      invalidModelActionCount,
      unknownModelActionCount,
      lastFailureAccounting,
      phaseProgressId,
      loopDetector: loopDetector.snapshot(),
      runtimeMessages: messages,
      pendingToolCall,
    };
  }

  async function startAttempt(attempt: {
    model: string;
    attemptId: string;
    attemptNumber: number;
    provisionalMessageId: string;
  }) {
    if (currentAttempt) {
      await discardAttempt(
        currentAttempt,
        new AttemptFailure("PROVIDER_RETRY", "Provider 在公开内容确认前重试。"),
      );
      currentAttempt = null;
    }
    logicalMessageId ??= attempt.provisionalMessageId;
    await options.repository.startAttempt(options.runId, {
      ...attempt,
      provisionalMessageId: logicalMessageId,
      now: new Date(),
    }, options.lease);
    attemptNumberOffset = attempt.attemptNumber;
    const attemptIdentity = {
      attemptId: attempt.attemptId,
      logicalMessageId,
    };
    const state = {} as AttemptState;
    Object.assign(state, {
      attemptId: attempt.attemptId,
      logicalMessageId,
      attemptNumber: attempt.attemptNumber,
      reasoningDeltaCount: 0,
      observedReasoningText: "",
      reasoningTail: createSafeTailBuffer(REASONING_SAFE_TAIL_CHARACTERS),
      reasoningStarted: false,
      responseDeltaCount: 0,
      publicReadTools: new Set<string>(),
      terminalToolCallId: null,
      terminalSeen: false,
      authorized: null,
      responseStarted: false,
      observedResponseText: "",
      responseTail: createSafeTailBuffer(RESPONSE_SAFE_TAIL_CHARACTERS),
      reasoning: createEventCoalescer({
        write: async (text) => {
          state.reasoningDeltaCount += 1;
          await appendPublicEvent("reasoning_delta", {
            runId: options.runId,
            attemptId: state.attemptId,
            entryId: `reasoning:${state.attemptId}`,
            text,
          }, attemptIdentity, `reasoning:${state.attemptId}:${state.reasoningDeltaCount}`);
        },
      }),
      response: createEventCoalescer({
        write: async (text) => {
          state.responseDeltaCount += 1;
          await appendPublicEvent("response_delta", {
            runId: options.runId,
            attemptId: state.attemptId,
            logicalMessageId: state.logicalMessageId,
            text,
            provisional: true,
          }, attemptIdentity, `response:${state.attemptId}:${state.responseDeltaCount}`);
        },
      }),
    } satisfies Partial<AttemptState>);
    currentAttempt = state;
    await appendPublicEvent("attempt_started", {
      runId: options.runId,
      attemptId: attempt.attemptId,
      logicalMessageId,
      attemptNumber: attempt.attemptNumber,
    }, attemptIdentity, `attempt:${attempt.attemptId}:started`);
    await appendPhase("reasoning", state);
  }

  async function handleStreamEvent(event: AgentModelStreamEvent): Promise<boolean> {
    const attempt = currentAttempt;
    if (!attempt || event.attemptId !== attempt.attemptId) {
      throw new AttemptFailure("STALE_STREAM_EVENT", "流事件不属于当前 attempt。");
    }
    const writesBefore = publicWriteCount;
    if (event.type === "public_reasoning_delta") {
      const reasoningValidation = validatePublicReasoningDelta(
        event.text,
        attempt.observedReasoningText,
      );
      if (!reasoningValidation.ok) {
        throw new AttemptFailure(reasoningValidation.code, reasoningValidation.message);
      }
      attempt.observedReasoningText = reasoningValidation.text;
      if (!attempt.reasoningStarted) {
        attempt.reasoningStarted = true;
        await appendPublicEvent("reasoning_started", {
          runId: options.runId,
          attemptId: attempt.attemptId,
          entryId: `reasoning:${attempt.attemptId}`,
        }, attempt, `reasoning:${attempt.attemptId}:started`);
      }
      const safePrefix = attempt.reasoningTail.acceptValidated(reasoningValidation.text);
      if (safePrefix) await attempt.reasoning.append(safePrefix);
      return publicWriteCount > writesBefore;
    }

    if (isTerminalTool(event.toolName)) {
      attempt.terminalSeen = true;
      attempt.terminalToolCallId ??= event.toolCallId;
      if (attempt.terminalToolCallId !== event.toolCallId) {
        throw new AttemptFailure("TERMINAL_CALL_CHANGED", "终结工具调用标识发生变化。");
      }
      await finishReasoning(attempt);
      await handleTerminalProgress(attempt, event.partialInput);
      return publicWriteCount > writesBefore;
    }

    const publicLabel = readToolLabel(event.toolName);
    if (!publicLabel) {
      throw new AttemptFailure("UNKNOWN_TOOL", "模型调用了未授权工具。");
    }
    if (!attempt.publicReadTools.has(event.toolCallId)) {
      await finishReasoning(attempt);
      attempt.publicReadTools.add(event.toolCallId);
      await appendPhase("tool_running", attempt);
      await appendPublicEvent("tool_call_started", {
        runId: options.runId,
        attemptId: attempt.attemptId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        publicLabel,
      }, attempt, `tool:${attempt.attemptId}:${event.toolCallId}:public-started`);
    }
    return publicWriteCount > writesBefore;
  }

  async function handleTerminalProgress(attempt: AttemptState, partialInput: unknown) {
    const progress = readTurnProposalProgress(partialInput);
    if (progress.status === "accumulating") return;
    if (progress.status === "protocol_violation") {
      throw new AttemptFailure(
        "RESPONSE_BEFORE_AUTHORIZATION",
        "responseText 在提案完成授权前出现。",
      );
    }

    if (!attempt.authorized) {
      await options.repository.saveCheckpoint(
        options.runId,
        checkpointFor("proposal_streaming"),
        options.lease,
      );
      const state = await options.repository.loadState(options.interviewId);
      const authorization = authorizeTurnProposal({
        state,
        mode: context.mode,
        answerCategory: context.answerCategory,
        prefix: progress.prefix,
      });
      if (!authorization.allowed) {
        throw new AttemptFailure(
          authorization.reason,
          `提案未通过确定性授权：${authorization.reason}`,
        );
      }
      await finishReasoning(attempt);
      await options.repository.authorizeProposal({
        runId: options.runId,
        lease: options.lease,
        attemptId: attempt.attemptId,
        logicalMessageId: attempt.logicalMessageId,
        proposal: authorization.prefix,
        proposalHash: authorization.proposalHash,
        checkpoint: checkpointFor("authorized"),
      });
      attempt.authorized = authorization;
      await appendPublicEvent("proposal_authorized", {
        runId: options.runId,
        attemptId: attempt.attemptId,
        logicalMessageId: attempt.logicalMessageId,
        proposalHash: authorization.proposalHash,
      }, attempt, `proposal:${attempt.attemptId}:authorized`);
      if (attempt.reasoningStarted) {
        await appendPublicEvent("reasoning_completed", {
          runId: options.runId,
          attemptId: attempt.attemptId,
          entryId: `reasoning:${attempt.attemptId}`,
        }, attempt, `reasoning:${attempt.attemptId}:completed`);
      }
      await appendPhase("authorized", attempt);
    } else if (
      hashTurnProposalPrefix(progress.prefix) !== attempt.authorized.proposalHash
    ) {
      throw new AttemptFailure("AUTHORIZED_PREFIX_CHANGED", "已授权提案字段发生变化。");
    }

    const responseText = progress.responseText;
    if (!responseText.startsWith(attempt.observedResponseText)) {
      throw new AttemptFailure("RESPONSE_REWRITTEN", "模型重写了已公开的回复前缀。");
    }
    const suffix = responseText.slice(attempt.observedResponseText.length);
    if (!suffix) return;
    const progressValidation = validateResponseProgress({
      action: attempt.authorized.prefix.decision.action,
      language: context.language,
      text: responseText,
      allowedTerms: context.allowedTerms,
    });
    if (!progressValidation.ok) {
      throw new AttemptFailure(progressValidation.code, progressValidation.message);
    }
    if (!attempt.responseStarted) {
      await options.repository.markResponseStarted({
        runId: options.runId,
        lease: options.lease,
        attemptId: attempt.attemptId,
        logicalMessageId: attempt.logicalMessageId,
        proposalHash: attempt.authorized.proposalHash,
      });
      attempt.responseStarted = true;
      await appendPublicEvent("response_started", {
        runId: options.runId,
        attemptId: attempt.attemptId,
        logicalMessageId: attempt.logicalMessageId,
      }, attempt, `response:${attempt.attemptId}:started`);
      await appendPhase("responding", attempt);
    }
    attempt.observedResponseText = responseText;
    const safePrefix = attempt.responseTail.acceptValidated(responseText);
    if (safePrefix) await attempt.response.append(safePrefix);
  }

  const committed = persistedEvents.some((event) => event.type === "message_committed");
  if (committed) {
    await options.repository.saveCheckpoint(
      options.runId,
      checkpointFor("acting"),
      options.lease,
    );
    await options.repository.terminateRun(
      options.runId,
      { exitReason: "completed" },
      options.lease,
    );
    return { exitReason: "completed", turnCount: planningStepCount };
  }

  if (persistedEvents.length === 0) {
    await appendPublicEvent("run_started", {
      runId: options.runId,
      logicalMessageId: null,
    }, { attemptId: null, logicalMessageId: null }, "run:started");
    await appendPhase("accepted", null);
    await options.repository.saveCheckpoint(
      options.runId,
      checkpointFor("accepted"),
      options.lease,
    );
  } else {
    const recoveredFailure = await discardInterruptedAttemptForRecovery();
    if (recoveredFailure === "provider_failed") {
      return failRun(
        options,
        "provider_failed",
        new Error("Recovered provider stream failure"),
        planningStepCount,
      );
    }
    const exhausted = exhaustedRepairExit();
    if (exhausted) {
      return failRun(
        options,
        exhausted,
        new Error("Recovered attempt exhausted its repair budget"),
        planningStepCount,
      );
    }
  }

  while (true) {
    if (options.signal.aborted) {
      return failRun(options, "aborted_streaming", options.signal.reason, planningStepCount);
    }
    if (!options.model.nextStepStream) {
      return failRun(
        options,
        "provider_failed",
        new Error("Agent model must support full streaming"),
        planningStepCount,
      );
    }

    const availableTools = planningStepCount >= MAX_PLANNING_STEPS
      ? new Map([...options.tools].filter(([name]) => isTerminalTool(name)))
      : new Map(options.tools);
    let step: AgentModelStep;
    try {
      modelCallCount += 1;
      await options.repository.saveCheckpoint(
        options.runId,
        checkpointFor("reasoning"),
        options.lease,
      );
      const streamed = await options.model.nextStepStream({
        runId: options.runId,
        messages,
        tools: [...availableTools.keys()].map((name) => ({
          name,
          description: describeTool(name),
        })),
        signal: options.signal,
        attemptNumberOffset,
        promptContext: options.promptContext,
        onAttemptStarted: startAttempt,
        onProviderProgress: () => options.repository.recordProviderProgress(
          options.runId,
          new Date(),
          options.lease,
        ),
        onStreamEvent: handleStreamEvent,
      });
      step = streamed.step;
      const selectedAttempt = currentAttempt as AttemptState | null;
      if (!selectedAttempt || streamed.attemptId !== selectedAttempt.attemptId) {
        throw new AttemptFailure("STALE_MODEL_RESULT", "模型结果不属于当前 attempt。");
      }

      if (step.type === "final") {
        throw new AttemptFailure("TOOL_CALL_REQUIRED", "模型必须调用当前可用工具。");
      }

      toolCallCount += 1;
      await options.repository.saveCheckpoint(
          options.runId,
          checkpointFor(
          selectedAttempt.authorized ? "responding" : "reasoning",
          step,
        ),
        options.lease,
      );
      if (isTerminalTool(step.toolName)) {
        return await finishTerminalAttempt(step, selectedAttempt);
      }
      const loopDecision = await executeReadTool(step, selectedAttempt, availableTools);
      invalidModelActionCount = 0;
      unknownModelActionCount = 0;
      lastFailureAccounting = null;
      planningStepCount += 1;
      await options.repository.saveCheckpoint(
        options.runId,
        checkpointFor("reasoning"),
        options.lease,
      );
      if (loopDecision.level === "break") {
        throw new FatalRunFailure(loopDecision.reason, loopDecision.message);
      }
      await selectedAttempt.reasoning.dispose();
      await selectedAttempt.response.discard();
      currentAttempt = null;
    } catch (error) {
      const failedAttempt = currentAttempt as AttemptState | null;
      if (isInjectedProcessCrash(error)) throw error;
      if (options.signal.aborted) {
        await discardAttempt(failedAttempt, error);
        return failRun(options, "aborted_streaming", error, planningStepCount);
      }
      if (error instanceof FatalRunFailure) {
        await discardAttempt(failedAttempt, error);
        return failRun(options, error.exitReason, error, planningStepCount);
      }
      const repairKind = classifyRepairCharge(error, failedAttempt);
      if (!repairKind) {
        if (failedAttempt) {
          recordFailureAccounting(failedAttempt.attemptId, "provider");
          await options.repository.saveCheckpoint(
            options.runId,
            checkpointFor("repairing"),
            options.lease,
          );
        }
        await discardAttempt(failedAttempt, error);
        return failRun(options, "provider_failed", error, planningStepCount);
      }
      if (!failedAttempt) {
        return failRun(options, "provider_failed", error, planningStepCount);
      }
      recordFailureAccounting(failedAttempt.attemptId, repairKind);
      ensureRepairInstruction(error);
      await options.repository.saveCheckpoint(
        options.runId,
        checkpointFor("repairing"),
        options.lease,
      );
      await discardAttempt(failedAttempt, error);
      const exhausted = exhaustedRepairExit();
      if (exhausted) {
        return failRun(
          options,
          exhausted,
          error,
          planningStepCount,
        );
      }
      currentAttempt = null;
    }
  }

  async function executeReadTool(
    step: Extract<AgentModelStep, { type: "tool_call" }>,
    attempt: AttemptState,
    availableTools: ReadonlyMap<string, InterviewToolDefinition<unknown, unknown>>,
  ): Promise<LoopDecision> {
    const definition = availableTools.get(step.toolName);
    const publicLabel = readToolLabel(step.toolName);
    if (!definition || !publicLabel) {
      throw new AttemptFailure("UNKNOWN_TOOL", "模型调用了未授权只读工具。");
    }
    await finishReasoning(attempt);
    if (!attempt.publicReadTools.has(step.callId)) {
      attempt.publicReadTools.add(step.callId);
      await appendPhase("tool_running", attempt);
      await appendPublicEvent("tool_call_started", {
        runId: options.runId,
        attemptId: attempt.attemptId,
        toolCallId: step.callId,
        toolName: step.toolName,
        publicLabel,
      }, attempt, `tool:${attempt.attemptId}:${step.callId}:public-started`);
    }
    const result = await executeInterviewTool({
      definition,
      rawInput: step.args,
      context: {
        interviewId: options.interviewId,
        runId: options.runId,
        repository: options.repository,
        toolCallId: step.callId,
        lease: options.lease,
        provisionalMessageId: attempt.logicalMessageId,
      },
      hooks: options.hooks,
    });
    await appendPublicEvent("tool_call_completed", {
      runId: options.runId,
      attemptId: attempt.attemptId,
      toolCallId: step.callId,
      toolName: step.toolName,
      publicLabel,
    }, attempt, `tool:${attempt.attemptId}:${step.callId}:public-completed`);
    if (!result.ok && result.error.code === "HOOK_STOPPED") {
      throw new FatalRunFailure("hook_stopped", result.error.message);
    }
    messages.push({
      role: "tool",
      content: JSON.stringify({
        callId: step.callId,
        toolName: step.toolName,
        result,
      }),
    });
    const loopDecision = loopDetector.record({
      toolName: step.toolName,
      args: step.args,
      result,
      progressHash: options.progressHash(),
      phase: "planning",
      phaseProgressId,
    });
    if (loopDecision.level === "warning") {
      messages.push({
        role: "system",
        content: loopDecision.message,
      });
    }
    await appendPhase("reasoning", attempt);
    return loopDecision;
  }

  async function finishTerminalAttempt(
    step: Extract<AgentModelStep, { type: "tool_call" }>,
    attempt: AttemptState,
  ): Promise<{ exitReason: AgentExitReason; turnCount: number }> {
    if (
      !attempt.terminalSeen
      || attempt.terminalToolCallId !== step.callId
      || !attempt.authorized
      || !attempt.responseStarted
    ) {
      throw new AttemptFailure(
        "TERMINAL_STREAM_INCOMPLETE",
        "终结提案没有经过完整的增量授权与回复流。",
      );
    }
    const finalProposal = interviewTurnProposalSchema.parse(step.args);
    const { responseText, ...finalPrefix } = finalProposal;
    if (hashTurnProposalPrefix(finalPrefix) !== attempt.authorized.proposalHash) {
      throw new AttemptFailure("AUTHORIZED_PREFIX_CHANGED", "最终提案与授权提案不一致。");
    }
    if (responseText !== attempt.observedResponseText) {
      throw new AttemptFailure("RESPONSE_STREAM_INCOMPLETE", "最终回复与已流式回复不一致。");
    }
    await appendPhase("validating", attempt);
    await options.repository.saveCheckpoint(
      options.runId,
      checkpointFor("validating"),
      options.lease,
    );
    const validation = validateFinalResponse({
      action: finalProposal.decision.action,
      language: context.language,
      text: responseText,
      allowedTerms: context.allowedTerms,
    });
    if (!validation.ok) {
      throw new AttemptFailure(validation.code, validation.message);
    }
    const responseTail = attempt.responseTail.finishValidated(responseText);
    if (responseTail) await attempt.response.append(responseTail);
    await attempt.response.flush();
    await appendPublicEvent("response_finished", {
      runId: options.runId,
      attemptId: attempt.attemptId,
      logicalMessageId: attempt.logicalMessageId,
      characterCount: [...responseText].length,
    }, attempt, `response:${attempt.attemptId}:finished`);
    await appendPhase("committing", attempt);
    await options.repository.saveCheckpoint(
      options.runId,
      checkpointFor("committing"),
      options.lease,
    );
    const terminalDefinition = options.tools.get(step.toolName);
    if (!terminalDefinition) {
      throw new AttemptFailure("UNKNOWN_TOOL", "终结工具不在当前授权工具集中。");
    }
    const parsed = terminalDefinition.inputSchema.safeParse(step.args);
    if (!parsed.success) {
      throw new AttemptFailure("INVALID_TOOL_INPUT", "终结工具参数格式无效。");
    }
    const normalized = terminalDefinition.normalize(parsed.data);
    const authorizedTerminalInput = structuredClone(normalized);
    const terminalContext = {
      interviewId: options.interviewId,
      runId: options.runId,
      repository: options.repository,
      toolCallId: step.callId,
      lease: options.lease,
      provisionalMessageId: attempt.logicalMessageId,
      authorizedTerminal: {
        toolCallId: step.callId,
        attemptId: attempt.attemptId,
        logicalMessageId: attempt.logicalMessageId,
        lease: options.lease,
        proposalHash: attempt.authorized.proposalHash,
        answerMessageId: context.answerMessageId,
        language: context.language,
      },
    };
    for (const hook of options.hooks ?? []) {
      const result = await hook.run({
        toolName: terminalDefinition.name,
        input: structuredClone(authorizedTerminalInput),
        context: terminalContext,
      });
      if (result.action === "stop") {
        throw new FatalRunFailure("hook_stopped", result.message);
      }
      if (!isDeepStrictEqual(result.input, authorizedTerminalInput)) {
        throw new FatalRunFailure(
          "hook_stopped",
          "终结工具前置 Hook 不得修改已授权提案。",
        );
      }
    }
    const businessError = await terminalDefinition.validateBusiness(
      authorizedTerminalInput,
      terminalContext,
    );
    if (businessError) {
      throw new AttemptFailure(businessError.code, businessError.message);
    }
    if (!(await terminalDefinition.authorize(authorizedTerminalInput, terminalContext))) {
      throw new AttemptFailure("TOOL_PERMISSION_DENIED", "终结工具未获授权。");
    }
    const outcome = await terminalDefinition.execute(authorizedTerminalInput, terminalContext);
    const committedEventSequence = readCommittedEventSequence(outcome);
    lastEventSequence = Math.max(lastEventSequence, committedEventSequence);
    await attempt.reasoning.dispose();
    await attempt.response.dispose();
    await options.repository.saveCheckpoint(
      options.runId,
      checkpointFor("acting"),
      options.lease,
    );
    await options.repository.terminateRun(
      options.runId,
      { exitReason: "completed" },
      options.lease,
    );
    return { exitReason: "completed", turnCount: planningStepCount };
  }

  async function discardAttempt(attempt: AttemptState | null, error: unknown) {
    if (!attempt) return;
    await attempt.reasoning.discard();
    await attempt.response.discard();
    const reason = classifyAttemptFailure(error);
    if (attempt.responseStarted) {
      await appendPublicEvent("response_discarded", {
        runId: options.runId,
        attemptId: attempt.attemptId,
        logicalMessageId: attempt.logicalMessageId,
        reason,
      }, attempt, `response:${attempt.attemptId}:discarded`);
    } else {
      await appendPublicEvent("attempt_discarded", {
        runId: options.runId,
        attemptId: attempt.attemptId,
        logicalMessageId: attempt.logicalMessageId,
        reason,
      }, attempt, `attempt:${attempt.attemptId}:discarded`);
    }
    await appendPhase("repairing", attempt);
    await options.repository.saveCheckpoint(
      options.runId,
      checkpointFor("repairing"),
      options.lease,
    );
  }

  async function finishReasoning(attempt: AttemptState) {
    const tail = attempt.reasoningTail.finishValidated(attempt.observedReasoningText);
    if (tail) await attempt.reasoning.append(tail);
    await attempt.reasoning.flush();
  }

  async function discardInterruptedAttemptForRecovery(): Promise<"provider_failed" | null> {
    const attemptId = persistedRun?.attemptId;
    const recoveredLogicalMessageId = persistedRun?.provisionalMessageId;
    if (!attemptId || !recoveredLogicalMessageId) return null;
    const attemptEvents = persistedEvents.filter((event) => event.attemptId === attemptId);
    const alreadyDiscarded = attemptEvents.some((event) => (
      event.type === "attempt_discarded" || event.type === "response_discarded"
    ));
    const hasResponse = attemptEvents.some((event) => event.type === "response_started");
    const hasProposal = attemptEvents.some((event) => event.type === "proposal_authorized");
    const completedReadTool = attemptEvents.some((event) => event.type === "tool_call_completed")
      && checkpoint?.phase === "reasoning"
      && checkpoint.runtimeMessages?.some((message) => message.role === "tool")
      && !hasProposal
      && !hasResponse;
    if (completedReadTool) return null;

    if (alreadyDiscarded) {
      const discarded = attemptEvents.find((event) => (
        event.type === "attempt_discarded" || event.type === "response_discarded"
      ));
      const discardedReason = discarded?.payload
        && typeof discarded.payload === "object"
        && typeof (discarded.payload as { reason?: unknown }).reason === "string"
        ? (discarded.payload as { reason: string }).reason
        : "WORKER_RECOVERY";
      if (lastFailureAccounting?.attemptId !== attemptId) {
        recordFailureAccounting(attemptId, hasProposal || hasResponse ? "terminal" : "invalid");
      }
      if (lastFailureAccounting?.kind !== "provider") {
        ensureRepairInstruction(Object.assign(new Error("Recovered discarded attempt"), {
          code: discardedReason,
        }));
      }
      await options.repository.saveCheckpoint(
        options.runId,
        checkpointFor("repairing"),
        options.lease,
      );
      return lastFailureAccounting?.kind === "provider" ? "provider_failed" : null;
    }

    const identity = { attemptId, logicalMessageId: recoveredLogicalMessageId };
    if (hasResponse) {
      await appendPublicEvent("response_discarded", {
        runId: options.runId,
        attemptId,
        logicalMessageId: recoveredLogicalMessageId,
        reason: "WORKER_RECOVERY",
      }, identity, `response:${attemptId}:discarded`);
    } else {
      await appendPublicEvent("attempt_discarded", {
        runId: options.runId,
        attemptId,
        logicalMessageId: recoveredLogicalMessageId,
        reason: "WORKER_RECOVERY",
      }, identity, `attempt:${attemptId}:discarded`);
    }
    if ((hasProposal || hasResponse) && lastFailureAccounting?.attemptId !== attemptId) {
      recordFailureAccounting(attemptId, "terminal");
    }
    if (lastFailureAccounting?.kind !== "provider") {
      ensureRepairInstruction(Object.assign(new Error("Worker recovered an interrupted attempt"), {
        code: "WORKER_RECOVERY",
      }));
    }
    await appendPublicEvent("phase_changed", {
      runId: options.runId,
      attemptId,
      phase: "repairing",
    }, identity, `phase:${attemptId}:repairing:recovery`);
    await options.repository.saveCheckpoint(
      options.runId,
      checkpointFor("repairing"),
      options.lease,
    );
    return lastFailureAccounting?.kind === "provider" ? "provider_failed" : null;
  }

  function recordFailureAccounting(attemptId: string, kind: FailureAccountingKind) {
    if (lastFailureAccounting?.attemptId === attemptId) return;
    if (kind === "terminal") terminalAttemptCount += 1;
    if (kind === "invalid") invalidModelActionCount += 1;
    if (kind === "unknown") unknownModelActionCount += 1;
    lastFailureAccounting = { attemptId, kind };
  }

  function ensureRepairInstruction(error: unknown) {
    const content = repairInstruction(error);
    if (messages.some((message) => message.role === "system" && message.content === content)) return;
    messages.push({ role: "system", content });
  }

  function exhaustedRepairExit(): AgentExitReason | null {
    if (unknownModelActionCount >= MAX_INVALID_MODEL_ACTIONS) return "aborted_tools";
    if (
      terminalAttemptCount >= MAX_TERMINAL_ATTEMPTS
      || invalidModelActionCount >= MAX_INVALID_MODEL_ACTIONS
    ) return "terminal_action_failed";
    return null;
  }
}

const MAX_REASONING_DELTA_CHARACTERS = 2_000;
const MAX_REASONING_TOTAL_CHARACTERS = 20_000;
const privateReasoningPatterns = [
  /(?:system|developer)\s*(?:prompt|message)/iu,
  /(?:内部|系统)(?:提示词|prompt|消息)/iu,
  /<\/?(?:system|developer|assistant|tool)(?:\s|>)/iu,
  /\b(?:run[_ -]?id|tool[_ -]?call[_ -]?id|lease[_ -]?(?:owner|generation|token)|proposal[_ -]?hash)\b/iu,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  /\b(?:attempt|call|message|run)-[A-Za-z0-9_-]{4,}\b/u,
  /\b[a-f0-9]{32,64}\b/iu,
  /\bDATABASE_URL\b|postgres(?:ql)?:\/\//iu,
  /\b(?:select|insert|update|delete)\b/iu,
  /\bapi[_ -]?key\b|\bsk-[A-Za-z0-9_-]{10,}/iu,
  /[A-Za-z0-9][A-Za-z0-9._%+-]{61,}[A-Za-z0-9]/u,
  /[A-Za-z0-9._%+-]{1,62}@/u,
  /(?:\+?\d[\d\s()-]{8,}\d|\b1[3-9]\d{9}\b)/u,
];

function validatePublicReasoningDelta(text: string, currentText: string):
  | { ok: true; text: string }
  | { ok: false; code: string; message: string } {
  const deltaCharacters = [...text].length;
  const combinedText = `${currentText}${text}`;
  const totalCharacters = [...combinedText].length;
  if (
    deltaCharacters === 0
    || deltaCharacters > MAX_REASONING_DELTA_CHARACTERS
    || totalCharacters > MAX_REASONING_TOTAL_CHARACTERS
  ) {
    return {
      ok: false,
      code: "REASONING_LENGTH_LIMIT",
      message: "公开分析超过允许长度。",
    };
  }
  if (privateReasoningPatterns.some((pattern) => pattern.test(combinedText))) {
    return {
      ok: false,
      code: "REASONING_SENSITIVE_CONTENT",
      message: "公开分析包含不允许公开的内部或敏感内容。",
    };
  }
  return { ok: true, text: combinedText };
}

function readCommittedEventSequence(outcome: unknown) {
  if (
    !outcome
    || typeof outcome !== "object"
    || typeof (outcome as { committedEventSequence?: unknown }).committedEventSequence !== "number"
  ) {
    throw new AttemptFailure("INVALID_TERMINAL_RESULT", "终结工具未返回有效提交结果。");
  }
  return (outcome as { committedEventSequence: number }).committedEventSequence;
}

function readToolLabel(name: string) {
  return Object.hasOwn(publicInterviewToolLabels, name)
    ? publicInterviewToolLabels[name as keyof typeof publicInterviewToolLabels]
    : null;
}

function describeTool(name: string) {
  const descriptions: Record<string, string> = {
    get_resume_evidence: "读取已授权的简历证据。",
    get_interview_history: "读取近期已提交面试记录。",
    get_coverage_state: "读取当前题型覆盖度。",
    submit_interview_turn: "提交本轮轻量评估、覆盖提案、唯一行动和最终回复；responseText 必须最后生成。",
  };
  return descriptions[name] ?? `Seconda interview domain tool: ${name}`;
}

class AttemptFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AttemptFailure";
    this.code = code;
  }
}

class FatalRunFailure extends Error {
  readonly exitReason: AgentExitReason;

  constructor(exitReason: AgentExitReason, message: string) {
    super(message);
    this.name = "FatalRunFailure";
    this.exitReason = exitReason;
  }
}

function classifyRepairCharge(
  error: unknown,
  attempt: AttemptState | null,
): FailureAccountingKind | null {
  if (error instanceof FatalRunFailure) return null;
  const provisionalAbort = readErrorCode(error) === "PROVISIONAL_STREAM_ABORTED";
  const protocolError = findErrorByCode(error, "MODEL_STREAM_PROTOCOL_ERROR");
  const toolCallRequired = findErrorByCode(error, "MODEL_TOOL_CALL_REQUIRED");
  const invalidToolAction = findErrorByCode(error, "MODEL_TOOL_ACTION_INVALID");
  if (provisionalAbort && !protocolError && !toolCallRequired && !invalidToolAction) return null;
  if (
    readErrorCode(error) === "UNKNOWN_TOOL"
    || readProtocolKind(protocolError) === "inactive_tool"
  ) return "unknown";
  if (
    attempt?.terminalSeen
    || attempt?.authorized
    || attempt?.responseStarted
  ) return "terminal";
  if (
    error instanceof AttemptFailure
    || protocolError
    || toolCallRequired
    || invalidToolAction
  ) return "invalid";
  return null;
}

function findErrorByCode(error: unknown, code: string): object | null {
  let current = error;
  const seen = new Set<object>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (readErrorCode(current) === code) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function readProtocolKind(error: object | null) {
  const protocol = (error as { protocol?: unknown } | null)?.protocol;
  if (!protocol || typeof protocol !== "object") return undefined;
  const kind = (protocol as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

function classifyAttemptFailure(error: unknown) {
  const value = error && typeof error === "object"
    ? error as { code?: unknown; cause?: unknown }
    : null;
  const cause = value?.cause && typeof value.cause === "object"
    ? value.cause as { code?: unknown }
    : null;
  const code = typeof cause?.code === "string"
    ? cause.code
    : typeof value?.code === "string"
      ? value.code
      : "ATTEMPT_FAILED";
  return code.slice(0, 100);
}

function isInjectedProcessCrash(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && (error as { code?: unknown }).code === "INJECTED_PROCESS_CRASH",
  );
}

function repairInstruction(error: unknown) {
  return `上一 attempt 已丢弃（${classifyAttemptFailure(error)}）。重新生成完整提案；responseText 必须最后输出，且不得修改已生成的文本前缀。`;
}

async function failRun(
  options: RunOptions,
  reason: AgentExitReason,
  error: unknown,
  turnCount: number,
) {
  const exitReason = error instanceof FatalRunFailure ? error.exitReason : reason;
  await options.repository.terminateRun(
    options.runId,
    { exitReason, error },
    options.lease,
  );
  return { exitReason, turnCount };
}
