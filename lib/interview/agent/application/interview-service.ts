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
