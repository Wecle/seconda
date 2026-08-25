import { db } from "@/lib/db";
import { appendAgentEvent, settleAgentRun } from "@/lib/agent/repository";
import { runAgent, safeAgentError } from "@/lib/agent/runtime";
import type { AgentEventSink } from "@/lib/agent/types";
import { applicationCapabilityRegistry } from "@/lib/application-capabilities";
import { buildOpeningModelMessage } from "../agent/context";
import type { ResumeEvidenceMap } from "../domain/create-interview";
import {
  claimInterviewOpeningRun,
  failInterviewOpeningRun,
  loadOpeningQuestion,
  loadOpeningRunStatus,
  type InterviewDatabase,
} from "../persistence/repository";

export type OpeningQuestion = NonNullable<Awaited<ReturnType<typeof loadOpeningQuestion>>>;

async function waitForOpeningQuestion(input: {
  database: InterviewDatabase;
  userId: string;
  openingRunId: string;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    const question = await loadOpeningQuestion(input);
    if (question) return question;
    const status = await loadOpeningRunStatus(input);
    if (status !== "running") throw new Error(`Interview opening run ended as ${status ?? "not_found"}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new DOMException("Interview opening run did not finish in time", "TimeoutError");
}

export async function executeInterviewOpening(input: {
  userId: string;
  openingRunId: string;
}, dependencies: {
  database?: InterviewDatabase;
  run?: typeof runAgent;
  signal?: AbortSignal;
} = {}): Promise<{ status: "active"; question: OpeningQuestion }> {
  const database = dependencies.database ?? db;
  const claim = await claimInterviewOpeningRun({
    database,
    userId: input.userId,
    openingRunId: input.openingRunId,
    buildModelMessage: ({ interview, snapshot }) => buildOpeningModelMessage({
      targetRole: interview.targetRole,
      preference: interview.preference,
      preferenceTags: interview.preferenceTags,
      targetRoundCount: interview.targetRoundCount,
      canonicalResume: snapshot.canonicalText,
      resumeEvidence: snapshot.evidenceJson as ResumeEvidenceMap,
    }),
  });
  if (claim.state === "completed") {
    return { status: "active", question: claim.question };
  }
  if (claim.state === "unavailable" && claim.status === "running") {
    const question = await waitForOpeningQuestion({
      database,
      userId: input.userId,
      openingRunId: input.openingRunId,
    });
    return { status: "active", question };
  }
  if (claim.state !== "claimed") {
    throw new Error(`Interview opening run is ${claim.state}`);
  }

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
        triggerType: "opening",
        attemptGeneration: claim.logicalRun.attemptGeneration,
      },
      maxSteps: claim.agentRun.maxSteps,
      signal,
      events,
    }, { capabilities: applicationCapabilityRegistry });
    const question = await loadOpeningQuestion({ database, userId: input.userId, openingRunId: input.openingRunId });
    if (!question) throw new Error("Interview agent finished without committing an opening question");
    await settleAgentRun({
      runId: claim.agentRun.id,
      sessionId: claim.session.id,
      status: "completed",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      terminalEvent: { type: "run_completed", payload: { usage } },
    });
    return { status: "active", question };
  } catch (error) {
    const committed = await loadOpeningQuestion({
      database,
      userId: input.userId,
      openingRunId: input.openingRunId,
    });
    if (committed) {
      await settleAgentRun({
        runId: claim.agentRun.id,
        sessionId: claim.session.id,
        status: "completed",
        terminalEvent: { type: "run_completed", payload: { recoveredAfterCommit: true } },
      }).catch(() => undefined);
      return { status: "active", question: committed };
    }
    const message = safeAgentError(error);
    await failInterviewOpeningRun({
      database,
      openingRunId: input.openingRunId,
      errorCode: "OPENING_RUN_FAILED",
    });
    await settleAgentRun({
      runId: claim.agentRun.id,
      sessionId: claim.session.id,
      status: "failed",
      errorMessage: message,
      terminalEvent: { type: "run_failed", payload: { code: "OPENING_RUN_FAILED" } },
    }).catch(() => undefined);
    throw error;
  }
}
