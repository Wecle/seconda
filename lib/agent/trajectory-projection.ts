import type {
  AgentEvent,
  TrajectoryStep,
  TrajectoryToolCall,
  TrajectoryTurn,
} from "./types";

function parseTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => {
      if (item && typeof item === "object") {
        const record = item as { type?: unknown; text?: unknown };
        return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
      }
      return [];
    })
    .join("\n");
}

type UntrustedInterviewData = {
  targetRole?: string;
  targetLevel?: string;
  interviewType?: string;
  language?: string;
  persona?: string;
  targetRoundCount?: number;
  answeredRoundCount?: number;
  remainingRounds?: number;
  preference?: string;
  canonicalResume?: string;
  jobDescription?: {
    title?: string;
    company?: string | null;
    mustHaveSkills?: readonly string[];
    canonicalText?: string;
  } | null;
  history?: readonly {
    sequence: number;
    kind: string;
    topic: string;
    question: string;
    answer: string | null;
    skipped: boolean;
  }[];
  coveredTopics?: readonly string[];
};

function parseUntrustedInterviewData(content: string): UntrustedInterviewData | null {
  const match = content.match(/<untrusted_interview_data>([\s\S]*?)<\/untrusted_interview_data>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as UntrustedInterviewData;
  } catch {
    return null;
  }
}

function formatInterviewContextMarkdown(data: UntrustedInterviewData): string {
  const parts: string[] = [];
  parts.push(`### 🎯 目标岗位与面试设定`);
  if (data.targetRole) {
    parts.push(`- **目标岗位**: ${data.targetRole} (${data.targetLevel ?? "Mid"})`);
  }
  if (data.interviewType || data.persona) {
    parts.push(`- **面试设定**: 类型: ${data.interviewType ?? "混合面"} · 语言: ${data.language ?? "zh"} · 人设: ${data.persona ?? "standard"}`);
  }
  if (data.targetRoundCount !== undefined) {
    parts.push(`- **轮次进度**: 已作答 ${data.answeredRoundCount ?? 0} 轮 / 目标 ${data.targetRoundCount} 轮 (剩余 ${data.remainingRounds ?? 0} 轮)`);
  }
  if (data.preference) {
    parts.push(`- **面试偏好**: ${data.preference}`);
  }

  if (data.jobDescription) {
    parts.push(`\n### 📋 目标岗位要求 (Job Description)`);
    parts.push(`- **岗位名称**: ${data.jobDescription.title ?? "未指定"}`);
    if (data.jobDescription.company) {
      parts.push(`- **公司**: ${data.jobDescription.company}`);
    }
    if (Array.isArray(data.jobDescription.mustHaveSkills) && data.jobDescription.mustHaveSkills.length > 0) {
      parts.push(`- **必备核心技能**: ${data.jobDescription.mustHaveSkills.join(", ")}`);
    }
    if (data.jobDescription.canonicalText) {
      parts.push(`\n\`\`\`\n${data.jobDescription.canonicalText}\n\`\`\``);
    }
  }

  if (data.canonicalResume) {
    parts.push(`\n### 📄 候选人简历事实 (Candidate Resume)`);
    parts.push(`\`\`\`\n${data.canonicalResume}\n\`\`\``);
  }

  if (Array.isArray(data.history) && data.history.length > 0) {
    parts.push(`\n### 📜 历史问答记录 (Interview History)`);
    for (const h of data.history) {
      parts.push(`- **Q#${h.sequence} [${h.topic}]**: ${h.question}`);
      parts.push(`  - **回答**: ${h.skipped ? "*(候选人跳过)*" : (h.answer ? h.answer : "*(未作答)*")}`);
    }
  }

  return parts.join("\n");
}

export type TrajectoryProjectionOptions = {
  systemPrompt?: string;
  extractTrigger?: (event: AgentEvent) => TrajectoryTurn["trigger"] | null;
  extractDomainOutcome?: (event: AgentEvent) => TrajectoryTurn["domainOutcome"] | null;
};

function extractTrigger(
  event: AgentEvent,
  customExtractor?: (event: AgentEvent) => TrajectoryTurn["trigger"] | null,
): TrajectoryTurn["trigger"] | null {
  if (customExtractor) {
    const custom = customExtractor(event);
    if (custom) return custom;
  }
  if (event.type === "user_message") {
    const payload = event.payload as { message?: { content?: unknown }; content?: unknown; text?: unknown };
    const content = payload.message?.content ?? payload.content ?? payload.text;
    return {
      type: "user_message",
      content: parseTextFromContent(content),
      sequence: event.sequence,
    };
  }
  if (event.type === "interview/session_initialized") {
    return {
      type: "opening_trigger",
      content: "Opening Round",
      sequence: event.sequence,
    };
  }
  if (event.type === "interview/answer_submitted") {
    const payload = event.payload as { content?: unknown; skipped?: unknown; sequence?: unknown };
    return {
      type: payload.skipped ? "candidate_skip" : "candidate_answer",
      content: typeof payload.content === "string" ? payload.content : "",
      sequence: event.sequence,
    };
  }
  return null;
}

/**
 * Pure projection from an immutable stream of AgentEvents into a turn-aware event ledger.
 * Respects event ordering and aggregates turns, steps, reasoning, tool calls, and metrics.
 */
export function projectTrajectory(
  events: readonly AgentEvent[],
  options?: TrajectoryProjectionOptions,
): TrajectoryTurn[] {
  const sorted = [...events].sort((left, right) => left.sequence - right.sequence);
  const turns: TrajectoryTurn[] = [];

  let currentTurn: TrajectoryTurn | null = null;
  let currentStep: TrajectoryStep | null = null;
  let turnCounter = 0;

  const ensureTurn = (
    trigger: TrajectoryTurn["trigger"],
    runId: string | null,
    startedAt: Date,
  ): TrajectoryTurn => {
    turnCounter += 1;
    const newTurn: TrajectoryTurn = {
      turnIndex: turnCounter,
      runId,
      status: "in_progress",
      startSequence: trigger.sequence,
      startedAt,
      trigger,
      items: [],
      steps: [],
      totalMetrics: {
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 0,
        toolCallCount: 0,
      },
    };

    if (turnCounter === 1 && options?.systemPrompt) {
      newTurn.items.push({
        id: `item-system-${trigger.sequence}`,
        sequence: 0,
        role: "system",
        title: "Initial System Prompt",
        preview: options.systemPrompt.trim().split("\n")[0]?.slice(0, 120) || "Initial System Prompt",
        content: options.systemPrompt,
        source: "System",
        status: "completed",
        durationMs: 0,
        timestamp: startedAt,
        raw: { systemPrompt: options.systemPrompt },
      });
    }

    newTurn.items.push({
      id: `item-user-${trigger.sequence}`,
      sequence: trigger.sequence,
      role: "user",
      title: trigger.type === "candidate_answer"
        ? "Candidate Answer"
        : trigger.type === "candidate_skip"
          ? "Candidate Skipped"
          : trigger.type === "opening_trigger"
            ? "Opening Round Initialized"
            : "User Message",
      preview: (trigger.content ?? "").trim().split("\n")[0]?.slice(0, 120) || "(Empty input)",
      content: trigger.content ?? "",
      source: trigger.type === "candidate_answer" ? "Candidate" : "User",
      status: "completed",
      durationMs: 0,
      timestamp: startedAt,
      raw: trigger,
    });

    turns.push(newTurn);
    currentTurn = newTurn;
    currentStep = null;
    return newTurn;
  };

  for (const event of sorted) {
    const detectedTrigger = extractTrigger(event, options?.extractTrigger);
    if (detectedTrigger) {
      ensureTurn(detectedTrigger, event.runId, event.createdAt);
      continue;
    }

    const activeTurn: TrajectoryTurn = currentTurn ?? ensureTurn(
      { type: "system", content: "Session Start", sequence: event.sequence },
      event.runId,
      event.createdAt,
    );

    if (event.runId && !activeTurn.runId) {
      activeTurn.runId = event.runId;
    }

    const ensureStep = (evt: AgentEvent): TrajectoryStep => {
      if (currentStep) return currentStep;
      currentStep = {
        stepIndex: activeTurn.steps.length + 1,
        runId: evt.runId ?? activeTurn.runId ?? "",
        attempt: 1,
        status: "running",
        startSequence: evt.sequence,
        startedAt: evt.createdAt,
        toolCalls: [],
      };
      activeTurn.steps.push(currentStep);
      return currentStep;
    };

    if (options?.extractDomainOutcome) {
      const outcome = options.extractDomainOutcome(event);
      if (outcome) {
        activeTurn.domainOutcome = outcome;
      }
    }

    switch (event.type) {
      case "model_message": {
        const payload = event.payload as {
          message?: {
            role?: unknown;
            content?: unknown;
          };
        };
        const message = payload.message;
        if (!message) break;
        const contentStr = parseTextFromContent(message.content);
        const untrustedData = parseUntrustedInterviewData(contentStr);
        if (untrustedData) {
          const roleStr = untrustedData.targetRole ? `${untrustedData.targetRole} (${untrustedData.targetLevel ?? "Mid"})` : "面试事实与简历";
          const histLen = untrustedData.history?.length ?? 0;
          activeTurn.items.push({
            id: `item-context-${event.sequence}`,
            sequence: event.sequence,
            role: "context",
            title: "面试事实与候选人上下文 (Interview Context)",
            preview: `${roleStr} · ${untrustedData.jobDescription?.title ? `JD: ${untrustedData.jobDescription.title} · ` : ""}${histLen} 轮历史问答`,
            content: formatInterviewContextMarkdown(untrustedData),
            source: "Runtime Context Injection",
            status: "completed",
            durationMs: 0,
            timestamp: event.createdAt,
            raw: untrustedData,
          });
        } else if (contentStr.trim()) {
          activeTurn.items.push({
            id: `item-context-${event.sequence}`,
            sequence: event.sequence,
            role: "context",
            title: "模型输入上下文 (Model Input Context)",
            preview: contentStr.slice(0, 120),
            content: contentStr,
            source: "Model Input",
            status: "completed",
            durationMs: 0,
            timestamp: event.createdAt,
            raw: event.payload,
          });
        }
        break;
      }

      case "request_context": {
        const payload = event.payload as Record<string, unknown>;
        const model = String(payload.model ?? "model");
        const est = Number(payload.estimatedTokens ?? 0);
        const win = Number(payload.contextWindow ?? 0);
        const hasRichContext = activeTurn.items.some(
          (it) => it.role === "context" && it.source === "Runtime Context Injection",
        );
        if (!hasRichContext) {
          activeTurn.items.push({
            id: `item-context-${event.sequence}`,
            sequence: event.sequence,
            role: "context",
            title: "上下文窗口预算度量 (Context Window Budget)",
            preview: `模型: ${model} · 预计 Token: ${est.toLocaleString()} / 窗口: ${win.toLocaleString()}`,
            content: `### 运行时上下文窗口预算\n- **模型**: \`${model}\`\n- **预估 Token**: ${est.toLocaleString()}\n- **上下文窗口**: ${win.toLocaleString()}\n- **操作预算**: ${Number(payload.operationalBudget ?? 0).toLocaleString()} tokens\n- **保留输出 Token**: ${Number(payload.reserveTokens ?? 0).toLocaleString()}`,
            source: "Context Lifecycle Engine",
            status: "completed",
            durationMs: 0,
            timestamp: event.createdAt,
            raw: payload,
          });
        }
        break;
      }

      case "step_started": {
        const payload = event.payload as { step?: unknown; attempt?: unknown };
        const stepIndex = typeof payload.step === "number" ? payload.step : activeTurn.steps.length + 1;
        const attempt = typeof payload.attempt === "number" ? payload.attempt : 1;

        currentStep = {
          stepIndex,
          runId: event.runId ?? activeTurn.runId ?? "",
          attempt,
          status: "running",
          startSequence: event.sequence,
          startedAt: event.createdAt,
          toolCalls: [],
        };
        activeTurn.steps.push(currentStep);
        break;
      }

      case "assistant_chunk": {
        const step = ensureStep(event);
        const payload = event.payload as {
          chunk?: {
            type?: unknown;
            blockType?: unknown;
            text?: unknown;
          };
        };
        const chunk = payload.chunk;
        if (!chunk) break;

        if (chunk.blockType === "reasoning" || chunk.type === "reasoning-delta") {
          step.reasoning ??= { content: "", complete: false };
          if (typeof chunk.text === "string") {
            step.reasoning.content += chunk.text;
          }
          if (chunk.type === "block-end") {
            step.reasoning.complete = true;
          }
        } else if (chunk.blockType === "text" || chunk.type === "text-delta") {
          if (typeof chunk.text === "string") {
            step.textDelta = (step.textDelta ?? "") + chunk.text;
          }
        }
        break;
      }

      case "tool_called": {
        const step = ensureStep(event);
        const payload = event.payload as {
          toolCallId?: unknown;
          toolName?: unknown;
          input?: unknown;
        };
        const toolCall: TrajectoryToolCall = {
          callId: String(payload.toolCallId ?? `call-${event.sequence}`),
          toolName: String(payload.toolName ?? "unknown"),
          input: payload.input ?? {},
          sequence: event.sequence,
        };
        step.toolCalls.push(toolCall);
        activeTurn.totalMetrics.toolCallCount += 1;
        activeTurn.items.push({
          id: `item-tool-${toolCall.callId}`,
          sequence: event.sequence,
          role: "tool",
          title: `Tool · ${toolCall.toolName}`,
          preview: `${toolCall.toolName}(${JSON.stringify(toolCall.input).slice(0, 80)})`,
          content: JSON.stringify({ input: toolCall.input }, null, 2),
          source: `Tool · ${toolCall.toolName}`,
          status: "running",
          timestamp: event.createdAt,
          raw: event.payload,
          toolCall,
        });
        break;
      }

      case "tool_completed": {
        const step = ensureStep(event);
        const payload = event.payload as {
          toolCallId?: unknown;
          toolName?: unknown;
          output?: unknown;
          error?: unknown;
          durationMs?: unknown;
        };
        const callId = String(payload.toolCallId ?? "");
        let matched = step.toolCalls.find((item) => item.callId === callId);
        if (!matched) {
          for (const s of activeTurn.steps) {
            matched = s.toolCalls.find((toolItem: TrajectoryToolCall) => toolItem.callId === callId);
            if (matched) break;
          }
        }

        if (matched) {
          if (payload.output !== undefined) matched.output = payload.output;
          if (payload.error !== undefined) matched.error = String(payload.error);
          if (typeof payload.durationMs === "number") matched.durationMs = payload.durationMs;
        } else {
          step.toolCalls.push({
            callId: callId || `call-${event.sequence}`,
            toolName: String(payload.toolName ?? "unknown"),
            input: {},
            output: payload.output,
            error: payload.error ? String(payload.error) : undefined,
            durationMs: typeof payload.durationMs === "number" ? payload.durationMs : undefined,
            sequence: event.sequence,
          });
          activeTurn.totalMetrics.toolCallCount += 1;
        }

        const toolItem = activeTurn.items.find((it) => it.role === "tool" && it.toolCall?.callId === callId);
        if (toolItem) {
          toolItem.status = payload.error ? "failed" : "completed";
          if (typeof payload.durationMs === "number") toolItem.durationMs = payload.durationMs;
          toolItem.content = JSON.stringify({
            input: toolItem.toolCall?.input,
            output: payload.output,
            error: payload.error,
            durationMs: payload.durationMs,
          }, null, 2);
          toolItem.preview = payload.error
            ? `Failed: ${String(payload.error)}`
            : `${toolItem.toolCall?.toolName ?? "Tool"} completed (${payload.durationMs ?? 0}ms)`;
          toolItem.raw = event.payload;
        }
        break;
      }

      case "step_completed": {
        const step = ensureStep(event);
        const payload = event.payload as {
          finishReason?: unknown;
          durationMs?: unknown;
          firstTokenMs?: unknown;
          usage?: {
            inputTokens?: unknown;
            outputTokens?: unknown;
            reasoningTokens?: unknown;
            cachedInputTokens?: unknown;
            totalTokens?: unknown;
          };
        };
        step.status = "completed";
        step.endSequence = event.sequence;
        step.completedAt = event.createdAt;
        if (step.reasoning) step.reasoning.complete = true;

        const usage = payload.usage ?? {};
        const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
        const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
        const reasoningTokens = typeof usage.reasoningTokens === "number" ? usage.reasoningTokens : 0;
        const cachedInputTokens = typeof usage.cachedInputTokens === "number" ? usage.cachedInputTokens : 0;
        const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : inputTokens + outputTokens;
        const durationMs = typeof payload.durationMs === "number" ? payload.durationMs : undefined;
        const firstTokenMs = typeof payload.firstTokenMs === "number" ? payload.firstTokenMs : undefined;

        step.metrics = {
          finishReason: String(payload.finishReason ?? "completed"),
          durationMs,
          firstTokenMs,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedInputTokens,
          totalTokens,
        };

        if (durationMs !== undefined) {
          activeTurn.totalMetrics.durationMs += durationMs;
        }
        activeTurn.totalMetrics.inputTokens += inputTokens;
        activeTurn.totalMetrics.outputTokens += outputTokens;
        activeTurn.totalMetrics.reasoningTokens += reasoningTokens;
        activeTurn.totalMetrics.cachedInputTokens += cachedInputTokens;
        activeTurn.totalMetrics.totalTokens += totalTokens;

        const submitActionCall = step.toolCalls.find((tc) => tc.toolName === "submit_interview_action");
        let assistantContent = step.textDelta || "";
        let assistantPreview = "";

        if (submitActionCall && submitActionCall.input) {
          const actionWrapper = submitActionCall.input as Record<string, unknown>;
          const action = (actionWrapper.action ?? actionWrapper) as Record<string, unknown>;
          const actionType = String(action.type ?? "");

          if (actionType === "ask_question" || action.question) {
            const qText = String(action.question ?? "");
            const topic = String(action.topic ?? "");
            const kind = action.kind === "follow_up" ? "追问 (Follow-up)" : "主干问题 (Main)";
            assistantPreview = `提问 [${topic || kind}]: ${qText.slice(0, 80)}`;

            const sections: string[] = [];
            sections.push(`### 💬 提出面试问题\n> **${qText}**\n\n- **主题**: ${topic || "未指定"} · **类型**: ${kind}`);

            if (action.evaluation && typeof action.evaluation === "object") {
              const ev = action.evaluation as Record<string, unknown>;
              sections.push(`\n### 📊 上一题回答评价 (Evaluation)\n- **综合评语**: ${ev.feedback ?? "无评语"}`);
              if (ev.understanding !== undefined) {
                sections.push(`- **六维评分**:\n  - 理解力: ${ev.understanding}/10 · 表达力: ${ev.expression}/10 · 逻辑性: ${ev.logic}/10\n  - 深度: ${ev.depth}/10 · 真实性: ${ev.authenticity}/10 · 反思力: ${ev.reflection}/10`);
              }
            }
            if (action.reasoning) {
              sections.push(`\n### 💡 出题动机与思路\n${action.reasoning}`);
            }
            if (assistantContent) {
              sections.push(`\n### 补充模型输出\n${assistantContent}`);
            }
            assistantContent = sections.join("\n");
          } else if (actionType === "complete_interview") {
            const closing = String(action.closingMessage ?? "面试已圆满完成");
            assistantPreview = `完成面试: ${closing.slice(0, 80)}`;
            assistantContent = `### 🏁 面试圆满结束\n${closing}\n\n${action.overallEvaluation ? `### 总体评价\n${action.overallEvaluation}` : ""}`;
          }
        }

        if (!assistantPreview) {
          assistantPreview = (assistantContent || step.reasoning?.content || "Model Generation").trim().split("\n")[0]?.slice(0, 120);
        }

        activeTurn.items.push({
          id: `item-assistant-${step.runId}-${step.stepIndex}-${step.attempt}`,
          sequence: event.sequence,
          role: "assistant",
          title: `Assistant · Step ${step.stepIndex}`,
          preview: assistantPreview || "Model Generation",
          content: assistantContent || step.reasoning?.content || "(无文本输出)",
          source: "Model",
          status: "completed",
          durationMs: step.metrics?.durationMs,
          timestamp: event.createdAt,
          metrics: step.metrics,
          reasoning: step.reasoning,
          raw: event.payload,
        });
        break;
      }

      case "step_retried": {
        if (currentStep) {
          currentStep.status = "retried";
          currentStep.endSequence = event.sequence;
        }
        break;
      }

      case "interview/question_committed": {
        const payload = event.payload as {
          sequence?: unknown;
          kind?: unknown;
          topic?: unknown;
          question?: unknown;
        };
        activeTurn.status = "completed";
        activeTurn.endSequence = event.sequence;
        activeTurn.completedAt = event.createdAt;
        activeTurn.domainOutcome = {
          type: "question_committed",
          summary: `Question #${String(payload.sequence ?? "")}: ${String(payload.topic ?? "Next Question")}`,
          payload: event.payload,
        };
        activeTurn.items.push({
          id: `item-outcome-${event.sequence}`,
          sequence: event.sequence,
          role: "outcome",
          title: `Question Committed (#${String(payload.sequence ?? "")})`,
          preview: typeof payload.question === "string" ? payload.question.slice(0, 120) : activeTurn.domainOutcome.summary,
          content: JSON.stringify(event.payload, null, 2),
          source: "Domain Action",
          status: "completed",
          durationMs: 0,
          timestamp: event.createdAt,
          raw: event.payload,
        });
        break;
      }

      case "interview/completion_requested": {
        const payload = event.payload as { closingMessage?: unknown };
        activeTurn.status = "completed";
        activeTurn.endSequence = event.sequence;
        activeTurn.completedAt = event.createdAt;
        activeTurn.domainOutcome = {
          type: "completion_requested",
          summary: typeof payload.closingMessage === "string" ? payload.closingMessage : "Interview Concluded",
          payload: event.payload,
        };
        activeTurn.items.push({
          id: `item-outcome-${event.sequence}`,
          sequence: event.sequence,
          role: "outcome",
          title: "Interview Concluded",
          preview: activeTurn.domainOutcome.summary,
          content: JSON.stringify(event.payload, null, 2),
          source: "Domain Action",
          status: "completed",
          durationMs: 0,
          timestamp: event.createdAt,
          raw: event.payload,
        });
        break;
      }

      case "assistant_message": {
        const payload = event.payload as { message?: { content?: unknown }; content?: unknown; text?: unknown };
        const content = payload.message?.content ?? payload.content ?? payload.text;
        const text = parseTextFromContent(content);
        if (text) {
          activeTurn.domainOutcome = {
            type: "assistant_message",
            summary: text,
            payload: event.payload,
          };
          const existingAssistant = activeTurn.items.find(
            (it) => it.role === "assistant" && it.sequence === event.sequence,
          );
          if (!existingAssistant) {
            activeTurn.items.push({
              id: `item-assistant-msg-${event.sequence}`,
              sequence: event.sequence,
              role: "assistant",
              title: "Assistant Message",
              preview: text.trim().split("\n")[0]?.slice(0, 120),
              content: text,
              source: "Assistant",
              status: "completed",
              durationMs: 0,
              timestamp: event.createdAt,
              raw: event.payload,
            });
          }
        }
        break;
      }

      case "run_completed": {
        if (activeTurn.status === "in_progress") {
          activeTurn.status = "completed";
        }
        activeTurn.endSequence = event.sequence;
        activeTurn.completedAt = event.createdAt;
        if (currentStep && currentStep.status === "running") {
          currentStep.status = "completed";
          currentStep.endSequence = event.sequence;
          currentStep.completedAt = event.createdAt;
        }
        break;
      }

      case "run_failed":
      case "run_cancelled":
      case "interview/completion_failed": {
        activeTurn.status = "failed";
        activeTurn.endSequence = event.sequence;
        activeTurn.completedAt = event.createdAt;
        if (currentStep && currentStep.status === "running") {
          currentStep.status = "failed";
          currentStep.endSequence = event.sequence;
          currentStep.completedAt = event.createdAt;
        }
        for (const it of activeTurn.items) {
          if (it.status === "running") {
            it.status = "failed";
          }
        }
        const errorPayload = event.payload as { error?: unknown; message?: unknown; code?: unknown };
        const errMsg = String(errorPayload.message ?? errorPayload.error ?? errorPayload.code ?? "Execution failed");
        activeTurn.items.push({
          id: `item-fail-${event.sequence}`,
          sequence: event.sequence,
          role: "outcome",
          title: "Run Failed",
          preview: errMsg,
          content: `### ❌ 执行失败 (Execution Failed)\n\`\`\`json\n${JSON.stringify(event.payload, null, 2)}\n\`\`\``,
          source: "System Error",
          status: "failed",
          durationMs: 0,
          timestamp: event.createdAt,
          raw: event.payload,
        });
        break;
      }

      default:
        break;
    }
  }

  // Ensure durationMs is populated from timestamps if not explicitly accumulated from step metrics
  for (const turn of turns) {
    if (turn.totalMetrics.durationMs === 0 && turn.completedAt) {
      turn.totalMetrics.durationMs = Math.max(0, turn.completedAt.getTime() - turn.startedAt.getTime());
    }
  }

  return turns;
}
