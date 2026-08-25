import { db } from "@/lib/db";
import { appendAgentEvent, settleAgentRun } from "@/lib/agent/repository";
import { runAgent, safeAgentError } from "@/lib/agent/runtime";
import type { AgentEventSink } from "@/lib/agent/types";
import { applicationCapabilityRegistry } from "@/lib/application-capabilities";
import { applicationSkillRegistry } from "@/lib/application-skills";
import type { ResumeEvidenceMap } from "../domain/create-interview";
import { projectInterviewRunModelMessage } from "../projections/model";
import {
  claimInterviewTurnRun,
  failInterviewTurnRun,
  loadInterviewTurnRunStatus,
  type InterviewDatabase,
} from "../persistence/repository";

async function waitForTurn(input: {
  database: InterviewDatabase;
  userId: string;
  interviewRunId: string;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    const outcome = await loadInterviewTurnRunStatus(input);
    if (!outcome) throw new Error("Interview turn disappeared");
    if (outcome.runStatus === "completed") return outcome;
    if (outcome.runStatus !== "running") {
      throw new Error(`Interview turn ended as ${outcome.runStatus}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new DOMException("Interview turn did not finish in time", "TimeoutError");
}

export async function executeInterviewTurn(input: {
  userId: string;
  interviewRunId: string;
}, dependencies: {
  database?: InterviewDatabase;
  run?: typeof runAgent;
  signal?: AbortSignal;
} = {}) {
  const database = dependencies.database ?? db;
  const claim = await claimInterviewTurnRun({
    database,
    userId: input.userId,
    interviewRunId: input.interviewRunId,
    buildModelMessage: ({ interview, snapshot, answer, question, history }) => {
      const projectedHistory = history.map((item) => ({
        sequence: item.sequence,
        kind: item.kind as "main" | "follow_up",
        topic: item.topic,
        question: item.question,
        answer: item.answerStatus === "answered" ? item.answer : null,
        skipped: item.answerStatus === "skipped",
      }));
      return projectInterviewRunModelMessage({
        trigger: answer.status === "skipped" ? "skip" : "answer",
        targetRole: interview.targetRole,
        targetLevel: interview.targetLevel as "Junior" | "Mid" | "Senior",
        interviewType: interview.interviewType as "behavioral" | "technical" | "mixed",
        language: interview.language as "zh" | "en" | "es" | "de",
        persona: interview.persona as "friendly" | "standard" | "stressful",
        preference: interview.preference,
        preferenceTags: interview.preferenceTags,
        targetRoundCount: interview.targetRoundCount,
        answeredRoundCount: interview.answeredRoundCount,
        remainingRounds: Math.max(0, interview.targetRoundCount - interview.answeredRoundCount),
        canonicalResume: snapshot.canonicalText,
        resumeEvidence: snapshot.evidenceJson as ResumeEvidenceMap,
        currentQuestion: {
          sequence: question.sequence,
          kind: question.kind as "main" | "follow_up",
          topic: question.topic,
          question: question.question,
          answer: answer.status === "answered" ? answer.content : null,
          skipped: answer.status === "skipped",
        },
        currentAnswer: { content: answer.content, skipped: answer.status === "skipped" },
        history: projectedHistory,
        coveredTopics: [...new Set(projectedHistory.map(({ topic }) => topic))],
      });
    },
  });
  if (claim.state === "completed") {
    const outcome = await loadInterviewTurnRunStatus({ database, userId: input.userId, interviewRunId: input.interviewRunId });
    if (!outcome) throw new Error("Completed interview turn disappeared");
    return outcome;
  }
  if (claim.state === "unavailable" && claim.status === "running") {
    return waitForTurn({ database, userId: input.userId, interviewRunId: input.interviewRunId });
  }
  if (claim.state !== "claimed") throw new Error(`Interview turn is ${claim.state}`);

  const events: AgentEventSink = {
    append: (type, payload) => appendAgentEvent({
      sessionId: claim.session.id,
      runId: claim.agentRun.id,
      type,
      payload,
    }),
  };
  const signal = dependencies.signal ?? AbortSignal.timeout(90_000);
  try {
    const usage = await (dependencies.run ?? runAgent)({
      sessionId: claim.session.id,
      runId: claim.agentRun.id,
      userId: input.userId,
      capability: claim.session.capability,
      promptVersion: claim.session.promptVersion,
      model: claim.session.model,
      systemPrompt: claim.session.systemPrompt,
      capabilityConfig: {
        interviewId: claim.interview.id,
        interviewRunId: claim.logicalRun.id,
        triggerType: claim.logicalRun.triggerType,
        attemptGeneration: claim.logicalRun.attemptGeneration,
      },
      maxSteps: claim.agentRun.maxSteps,
      signal,
      events,
    }, { capabilities: applicationCapabilityRegistry, skills: applicationSkillRegistry });
    const outcome = await loadInterviewTurnRunStatus({
      database,
      userId: input.userId,
      interviewRunId: input.interviewRunId,
    });
    if (!outcome || outcome.runStatus !== "completed") {
      throw new Error("Interview agent finished without committing a turn action");
    }
    await settleAgentRun({
      runId: claim.agentRun.id,
      sessionId: claim.session.id,
      status: "completed",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      terminalEvent: { type: "run_completed", payload: { usage } },
    });
    return outcome;
  } catch (error) {
    const outcome = await loadInterviewTurnRunStatus({
      database,
      userId: input.userId,
      interviewRunId: input.interviewRunId,
    });
    if (outcome?.runStatus === "completed") {
      await settleAgentRun({
        runId: claim.agentRun.id,
        sessionId: claim.session.id,
        status: "completed",
        terminalEvent: { type: "run_completed", payload: { recoveredAfterCommit: true } },
      }).catch(() => undefined);
      return outcome;
    }
    const message = safeAgentError(error);
    await failInterviewTurnRun({
      database,
      interviewRunId: input.interviewRunId,
      errorCode: "INTERVIEW_TURN_FAILED",
    });
    await settleAgentRun({
      runId: claim.agentRun.id,
      sessionId: claim.session.id,
      status: "failed",
      errorMessage: message,
      terminalEvent: { type: "run_failed", payload: { code: "INTERVIEW_TURN_FAILED" } },
    }).catch(() => undefined);
    throw error;
  }
}
