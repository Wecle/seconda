import { db } from "@/lib/db";
import { appendAgentEvent, recordCompletedAgentRunUsage } from "@/lib/agent/repository";
import { runAgent } from "@/lib/agent/runtime";
import type { AgentEventSink } from "@/lib/agent/types";
import { applicationCapabilityRegistry } from "@/lib/application-capabilities";
import { applicationSkillRegistry } from "@/lib/application-skills";
import { buildOpeningModelMessage } from "../agent/context";
import type { ResumeEvidenceMap } from "../domain/create-interview";
import {
  claimInterviewOpeningRun,
  failInterviewOpeningRun,
  loadOpeningQuestion,
  loadOpeningRunStatus,
  type InterviewDatabase,
} from "../persistence/repository";
import { createInterviewLeaseOwner, startInterviewRunLease } from "./run-lease";

export type OpeningQuestion = NonNullable<Awaited<ReturnType<typeof loadOpeningQuestion>>>;

class InterviewOpeningLeaseExpiredError extends Error {}

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
    const run = await loadOpeningRunStatus(input);
    if (run?.status !== "running") throw new Error(`Interview opening run ended as ${run?.status ?? "not_found"}`);
    if (!run.leaseExpiresAt || run.leaseExpiresAt <= new Date()) throw new InterviewOpeningLeaseExpiredError();
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
  const leaseOwner = createInterviewLeaseOwner();
  const claim = await claimInterviewOpeningRun({
    database,
    userId: input.userId,
    openingRunId: input.openingRunId,
    leaseOwner,
    buildModelMessage: ({ interview, snapshot, jobSnapshot }) => buildOpeningModelMessage({
      language: interview.language as "zh" | "en" | "es" | "de",
      persona: interview.persona as "friendly" | "standard" | "stressful",
      interviewType: interview.interviewType as "behavioral" | "technical" | "mixed",
      targetLevel: interview.targetLevel as "Junior" | "Mid" | "Senior",
      targetRole: interview.targetRole,
      preference: interview.preference,
      preferenceTags: interview.preferenceTags,
      targetRoundCount: interview.targetRoundCount,
      canonicalResume: snapshot.canonicalText,
      resumeEvidence: snapshot.evidenceJson as ResumeEvidenceMap,
      jobDescription: jobSnapshot ? {
        title: jobSnapshot.title,
        company: jobSnapshot.company,
        mustHaveSkills: jobSnapshot.parsedJson.mustHaveSkills,
        canonicalText: jobSnapshot.canonicalText,
      } : null,
    }),
  });
  if (claim.state === "completed") {
    return { status: "active", question: claim.question };
  }
  if (claim.state === "unavailable" && claim.status === "running") {
    try {
      const question = await waitForOpeningQuestion({
        database,
        userId: input.userId,
        openingRunId: input.openingRunId,
      });
      return { status: "active", question };
    } catch (error) {
      if (error instanceof InterviewOpeningLeaseExpiredError) {
        return executeInterviewOpening(input, dependencies);
      }
      throw error;
    }
  }
  if (claim.state !== "claimed") {
    throw new Error(`Interview opening run is ${claim.state}`);
  }

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
        triggerType: "opening",
        attemptGeneration: claim.logicalRun.attemptGeneration,
        leaseOwner,
      },
      skillSnapshotRunId: claim.skillSnapshotRunId,
      modelContextBoundarySequence: claim.modelContextBoundarySequence,
      maxSteps: claim.agentRun.maxSteps,
      signal: lease.signal,
      events,
    }, { capabilities: applicationCapabilityRegistry, skills: applicationSkillRegistry });
    const question = await loadOpeningQuestion({ database, userId: input.userId, openingRunId: input.openingRunId });
    if (!question) throw new Error("Interview agent finished without committing an opening question");
    await recordCompletedAgentRunUsage({
      runId: claim.agentRun.id,
      sessionId: claim.session.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    }).catch(() => false);
    return { status: "active", question };
  } catch (error) {
    const committed = await loadOpeningQuestion({
      database,
      userId: input.userId,
      openingRunId: input.openingRunId,
    });
    if (committed) {
      return { status: "active", question: committed };
    }
    await failInterviewOpeningRun({
      database,
      openingRunId: input.openingRunId,
      agentRunId: claim.agentRun.id,
      attemptGeneration: claim.logicalRun.attemptGeneration,
      leaseOwner,
      errorCode: "OPENING_RUN_FAILED",
    });
    throw error;
  } finally {
    lease.stop();
  }
}
