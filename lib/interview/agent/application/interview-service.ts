import { randomUUID } from "node:crypto";
import type { InterviewAgentRepository } from "@/lib/interview/agent/persistence/repository";
import { getRecoveryDisposition } from "@/lib/interview/agent/application/recovery-policy";
import type {
  AgentRunScheduler,
} from "@/lib/interview/agent/application/ports";
import type { AgentInterviewStore } from "@/lib/interview/agent/persistence/interview-store";
import {
  ANSWER_RUN_INSTRUCTION,
  buildOpeningInstruction,
} from "@/lib/interview/agent/prompts/turn-instructions";
import type { InterviewConfigV2 } from "@/lib/interview/settings";

export async function createAgentInterview(options: {
  input: {
    ownerUserId: string;
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
    ownerUserId: options.input.ownerUserId,
    idempotencyKey: options.input.idempotencyKey,
    resumeVersionId: options.input.resumeVersionId,
    config: options.input.config,
  });
  await options.store.initializeCoverage(created.interviewId);
  const run = await options.repository.createRun({
    interviewId: created.interviewId,
    idempotencyKey: options.input.idempotencyKey,
  });
  let persistedRun = await options.repository.getRun(run.id);
  if (!persistedRun) throw new Error("Opening run could not be loaded");
  if (persistedRun.status === "running" && !persistedRun.trigger) {
    await options.repository.saveRunTrigger(run.id, {
      mode: "opening",
      instruction: buildOpeningInstruction(created.resumeSummary),
    });
    persistedRun = await options.repository.getRun(run.id);
    if (!persistedRun?.trigger) throw new Error("Opening run trigger could not be persisted");
  }
  if (getRecoveryDisposition(persistedRun, new Date()) === "schedule") {
    await options.scheduler.schedule(run.id);
  }
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
    interview.status !== "active"
  ) {
    throw new Error("Interview is not active");
  }

  const runKey = `message:${options.input.idempotencyKey}`;
  const accepted = await options.store.acceptCandidateMessage({
    ...options.input,
    runIdempotencyKey: runKey,
    trigger: {
      mode: "answer",
      instruction: ANSWER_RUN_INSTRUCTION,
    },
  });

  const run = await options.repository.getRun(accepted.runId);
  if (!run) throw new Error("Accepted answer run could not be loaded");
  if (getRecoveryDisposition(run, new Date()) === "schedule") {
    await options.scheduler.schedule(accepted.runId);
  }
  return {
    runId: accepted.runId,
    status: "accepted" as const,
    runStatus: run.status,
    message: publicMessage(accepted),
  };
}

type RetryFailedRunErrorCode =
  | "RETRY_RUN_NOT_FOUND"
  | "RETRY_RUN_NOT_FAILED"
  | "RETRY_RUN_NOT_REPLACEABLE"
  | "RETRY_RUN_TRIGGER_MISSING"
  | "RETRY_RUN_ANSWER_MISSING"
  | "RETRY_RUN_STALE";

function retryFailedRunError(code: RetryFailedRunErrorCode) {
  return Object.assign(new Error(code), { code });
}

export async function retryFailedAgentRun(options: {
  interviewId: string;
  failedRunId: string;
  repository: InterviewAgentRepository;
  scheduler: AgentRunScheduler;
  now: Date;
}) {
  const source = await options.repository.getRun(options.failedRunId);
  if (!source || source.interviewId !== options.interviewId) {
    throw retryFailedRunError("RETRY_RUN_NOT_FOUND");
  }
  if (source.status !== "failed") {
    throw retryFailedRunError("RETRY_RUN_NOT_FAILED");
  }
  if (getRecoveryDisposition(source, options.now) !== "failed") {
    throw retryFailedRunError("RETRY_RUN_NOT_REPLACEABLE");
  }
  if (!source.trigger) {
    throw retryFailedRunError("RETRY_RUN_TRIGGER_MISSING");
  }

  let replacementTrigger = source.trigger;
  if (source.trigger.mode !== "opening") {
    const answerMessageId = source.trigger.answerMessageId
      ?? (await options.repository.findCandidateAnswerForRun(source.id))?.id;
    if (!answerMessageId) {
      throw retryFailedRunError("RETRY_RUN_ANSWER_MISSING");
    }
    replacementTrigger = { ...source.trigger, answerMessageId };
  }

  const idempotencyKey = `retry-of:${source.id}`;
  const replacement = await options.repository.createReplacementRun({
    interviewId: options.interviewId,
    sourceRunId: source.id,
    idempotencyKey,
    trigger: replacementTrigger,
  });
  if (replacement.outcome === "inactive") {
    throw retryFailedRunError("RETRY_RUN_NOT_REPLACEABLE");
  }
  if (replacement.outcome === "stale") {
    throw retryFailedRunError("RETRY_RUN_STALE");
  }
  const persisted = await options.repository.getRun(replacement.runId);
  if (!persisted) throw retryFailedRunError("RETRY_RUN_NOT_FOUND");
  if (!persisted.trigger) {
    throw retryFailedRunError("RETRY_RUN_TRIGGER_MISSING");
  }
  if (getRecoveryDisposition(persisted, options.now) === "schedule") {
    await options.scheduler.schedule(persisted.id);
  }
  const scheduled = await options.repository.getRun(persisted.id);
  return {
    runId: persisted.id,
    runStatus: scheduled?.status ?? persisted.status,
  };
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
  if (!interview) {
    throw new Error("Interview not found");
  }
  if (["completing", "scoring", "reporting", "completed", "failed"].includes(interview.status)) {
    return { status: "completing" as const };
  }
  if (interview.status !== "active") {
    throw new Error("Interview cannot be completed from its current state");
  }

  const transition = await options.repository.markInterviewCompleting(options.interviewId);
  if (!transition.changed) return { status: "completing" as const };
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
