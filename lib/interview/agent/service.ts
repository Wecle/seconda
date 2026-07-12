import { randomUUID } from "node:crypto";
import type { AgentExitReason } from "./contracts";
import type { InterviewAgentRepository } from "./repository";
import type { InterviewConfigV2 } from "../settings";

export interface AgentInterviewStore {
  createInterview(input: {
    resumeVersionId: string;
    config: InterviewConfigV2;
  }): Promise<{ interviewId: string; resumeSummary: string }>;
  initializeCoverage(interviewId: string): Promise<void>;
  loadInterview(interviewId: string): Promise<{
    id: string;
    status: string;
    configVersion: number;
    candidateRoundCount: number;
  } | null>;
  acceptCandidateMessage(input: {
    interviewId: string;
    runId: string;
    content: string;
    idempotencyKey: string;
  }): Promise<{ id: string; sequence: number; content: string; created: boolean }>;
  markCompleting(interviewId: string): Promise<boolean>;
}

export interface AgentRunExecutor {
  run(input: {
    interviewId: string;
    runId: string;
    mode: "opening" | "answer";
    instruction: string;
    signal: AbortSignal;
  }): Promise<{ exitReason: AgentExitReason }>;
}

export interface AgentRunScheduler {
  schedule(runId: string): Promise<void>;
}

export async function createAgentInterview(options: {
  input: {
    resumeVersionId: string;
    config: InterviewConfigV2;
    idempotencyKey: string;
  };
  store: AgentInterviewStore;
  repository: InterviewAgentRepository;
  scheduler: AgentRunScheduler;
  signal: AbortSignal;
}) {
  const created = await options.store.createInterview({
    resumeVersionId: options.input.resumeVersionId,
    config: options.input.config,
  });
  await options.store.initializeCoverage(created.interviewId);
  const run = await options.repository.createRun({
    interviewId: created.interviewId,
    idempotencyKey: options.input.idempotencyKey,
  });
  await options.repository.saveRunTrigger(run.id, {
    mode: "opening",
    instruction: openingInstruction(created.resumeSummary),
  });
  await options.scheduler.schedule(run.id);
  return {
    interviewId: created.interviewId,
    runId: run.id,
    status: "active" as const,
  };
}

export async function submitCandidateMessage(options: {
  input: {
    interviewId: string;
    content: string;
    idempotencyKey: string;
  };
  store: AgentInterviewStore;
  repository: InterviewAgentRepository;
  scheduler: AgentRunScheduler;
  signal: AbortSignal;
}) {
  const interview = await options.store.loadInterview(options.input.interviewId);
  if (
    !interview ||
    interview.configVersion !== 2 ||
    interview.status !== "active"
  ) {
    throw new Error("Interview is not an active v2 interview");
  }

  const runKey = `message:${options.input.idempotencyKey}`;
  const existingOrNewRun = await options.repository.createRun({
    interviewId: options.input.interviewId,
    idempotencyKey: runKey,
  });
  const accepted = await options.store.acceptCandidateMessage({
    ...options.input,
    runId: existingOrNewRun.id,
  });

  if (!accepted.created && !existingOrNewRun.created) {
    return { runId: existingOrNewRun.id, status: "accepted" as const, message: publicMessage(accepted) };
  }

  await options.repository.saveRunTrigger(existingOrNewRun.id, {
    mode: "answer",
    instruction:
      "评估候选人的最新回答，更新覆盖度，然后选择一个深入追问、一个新主题或结束面试。一次只提交一个候选人可见结果。",
  });
  await options.scheduler.schedule(existingOrNewRun.id);
  return { runId: existingOrNewRun.id, status: "accepted" as const, message: publicMessage(accepted) };
}

function publicMessage(message: { id: string; sequence: number; content: string }) {
  return { id: message.id, sequence: message.sequence, content: message.content };
}

export async function endAgentInterview(options: {
  interviewId: string;
  store: AgentInterviewStore;
  repository: InterviewAgentRepository;
}) {
  const interview = await options.store.loadInterview(options.interviewId);
  if (!interview || interview.configVersion !== 2) {
    throw new Error("Interview is not a v2 interview");
  }
  if (["completing", "scoring", "reporting", "completed", "failed"].includes(interview.status)) {
    return { status: "completing" as const };
  }
  if (interview.status !== "active") {
    throw new Error("Interview cannot be completed from its current state");
  }

  const changed = await options.store.markCompleting(options.interviewId);
  if (!changed) return { status: "completing" as const };
  const run = await options.repository.createRun({
    interviewId: options.interviewId,
    idempotencyKey: `user-end:${randomUUID()}`,
  });
  await options.repository.appendMessage({
    interviewId: options.interviewId,
    runId: run.id,
    role: "assistant",
    kind: "finish",
    content: "好的，本次面试到这里结束。我会根据刚才的交流生成面试报告。",
  });
  await options.repository.completeRun(run.id, "completed");
  return { status: "completing" as const };
}

function openingInstruction(resumeSummary: string) {
  return `候选人简历摘要：${resumeSummary}\n请基于简历证据判断最可能的目标岗位。岗位明确时说明本次面试岗位并邀请候选人自我介绍；存在多个同等可能方向时，只提出一个岗位澄清问题。不得暴露内部推理或覆盖度。`;
}
