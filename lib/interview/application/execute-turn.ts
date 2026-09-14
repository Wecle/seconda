import { db } from "@/lib/db";
import { appendAgentEvent, recordCompletedAgentRunUsage } from "@/lib/agent/repository";
import { runAgent } from "@/lib/agent/runtime";
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
  type SafeInterviewRunFailure,
} from "../persistence/repository";
import { createInterviewLeaseOwner, startInterviewRunLease } from "./run-lease";
import { executeInterviewCompletion } from "./execute-completion";

class InterviewTurnLeaseExpiredError extends Error {}

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
    if (!outcome.leaseExpiresAt || outcome.leaseExpiresAt <= new Date()) throw new InterviewTurnLeaseExpiredError();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new DOMException("Interview turn did not finish in time", "TimeoutError");
}

function classifyTurnFailure(error: unknown): SafeInterviewRunFailure {
  if (error instanceof Error) {
    if (
      error.message.includes("COMPACTION_") ||
      error.message.includes("Compaction") ||
      error.message.includes("compact")
    ) {
      const reasonCode = error.message.includes("COMPACTION_REPLACEMENT_REJECTED")
        ? "COMPACTION_REPLACEMENT_REJECTED"
        : error.message.includes("COMPACTION_DID_NOT_REDUCE_CONTEXT")
          ? "COMPACTION_DID_NOT_REDUCE_CONTEXT"
          : error.message.includes("CONTEXT_REMAINS_OVER_BUDGET")
            ? "CONTEXT_REMAINS_OVER_BUDGET"
            : "COMPACTION_FAILED";
      return {
        code: "INTERVIEW_TURN_FAILED",
        stage: "compact_context",
        reasonCode,
        retryable: true,
      };
    }
    if (
      error.message.includes("Context exceeds") ||
      error.message.includes("context overflow")
    ) {
      return {
        code: "INTERVIEW_TURN_FAILED",
        stage: "prepare_context",
        reasonCode: "CONTEXT_OVERFLOW",
        retryable: true,
      };
    }
    if (
      error.message.includes("without committing a turn action") ||
      error.message.includes("domain")
    ) {
      return {
        code: "INTERVIEW_TURN_FAILED",
        stage: "domain_commit",
        reasonCode: "NO_TURN_ACTION_COMMITTED",
        retryable: true,
      };
    }
    if (
      error.message.includes("Tool") ||
      error.message.includes("tool") ||
      error.name === "RepeatedToolCallError"
    ) {
      return {
        code: "INTERVIEW_TURN_FAILED",
        stage: "tool_execution",
        reasonCode: "TOOL_ERROR",
        retryable: true,
      };
    }
    if (
      error.message.includes("Model") ||
      error.message.includes("provider") ||
      error.message.includes("503") ||
      error.message.includes("429")
    ) {
      return {
        code: "INTERVIEW_TURN_FAILED",
        stage: "model_request",
        reasonCode: "PROVIDER_ERROR",
        retryable: true,
      };
    }
  }
  return {
    code: "INTERVIEW_TURN_FAILED",
    stage: "unknown",
    retryable: true,
  };
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
  const leaseOwner = createInterviewLeaseOwner();
  const claim = await claimInterviewTurnRun({
    database,
    userId: input.userId,
    interviewRunId: input.interviewRunId,
    leaseOwner,
    buildModelMessage: ({ interview, snapshot, jobSnapshot, answer, question, history }) => {
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
        jobDescription: jobSnapshot ? {
          title: jobSnapshot.title,
          company: jobSnapshot.company,
          mustHaveSkills: jobSnapshot.parsedJson.mustHaveSkills,
          canonicalText: jobSnapshot.canonicalText,
        } : null,
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
    try {
      return await waitForTurn({ database, userId: input.userId, interviewRunId: input.interviewRunId });
    } catch (error) {
      if (error instanceof InterviewTurnLeaseExpiredError) {
        return executeInterviewTurn(input, dependencies);
      }
      throw error;
    }
  }
  if (claim.state !== "claimed") throw new Error(`Interview turn is ${claim.state}`);

  const events: AgentEventSink = {
    append: (type, payload) => appendAgentEvent({
      sessionId: claim.session.id,
      runId: type === "skill_catalog_snapshotted" ? claim.skillSnapshotRunId : claim.agentRun.id,
      type,
      payload,
    }),
  };
  const lease = startInterviewRunLease({
    database,
    interviewRunId: claim.logicalRun.id,
    agentRunId: claim.agentRun.id,
    attemptGeneration: claim.logicalRun.attemptGeneration,
    leaseOwner,
    signal: dependencies.signal ?? AbortSignal.timeout(90_000),
  });
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
        leaseOwner,
      },
      skillSnapshotRunId: claim.skillSnapshotRunId,
      modelContextBoundarySequence: claim.modelContextBoundarySequence,
      maxSteps: claim.agentRun.maxSteps,
      signal: lease.signal,
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
    await recordCompletedAgentRunUsage({
      runId: claim.agentRun.id,
      sessionId: claim.session.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    }).catch(() => false);
    if (outcome.interviewStatus === "completing") {
      await executeInterviewCompletion({
        interviewId: claim.interview.id,
        userId: input.userId,
      }).catch((err) => {
        console.error("Background completion execution failed", err);
      });
    }
    return outcome;
  } catch (error) {
    const outcome = await loadInterviewTurnRunStatus({
      database,
      userId: input.userId,
      interviewRunId: input.interviewRunId,
    });
    if (outcome?.runStatus === "completed") {
      return outcome;
    }
    await failInterviewTurnRun({
      database,
      interviewRunId: input.interviewRunId,
      agentRunId: claim.agentRun.id,
      attemptGeneration: claim.logicalRun.attemptGeneration,
      leaseOwner,
      error: classifyTurnFailure(error),
    });
    throw error;
  } finally {
    lease.stop();
  }
}
