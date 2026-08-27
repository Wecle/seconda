import { db } from "@/lib/db";
import { loadModelPolicy } from "@/lib/ai/model-policy";
import { appendAgentEventsInTransaction } from "@/lib/agent/repository";
import { serializeParsedResume } from "@/lib/resume/canonical-text";
import { parsedResumeSchema } from "@/lib/resume/types";
import {
  buildInterviewSystemPrompt,
  INTERVIEW_AGENT_PROMPT_VERSION,
} from "../agent/prompt";
import {
  buildResumeEvidence,
  createInterviewRequestHash,
  createInterviewRequestSchema,
  creationIdempotencyKeySchema,
  hashCanonical,
} from "../domain/create-interview";
import { InterviewApplicationError } from "../domain/errors";
import {
  findInterviewCreation,
  insertInterviewCreation,
  loadOwnedResumeVersion,
  lockInterviewCreationKey,
} from "../persistence/repository";

export type CreateInterviewResult = {
  interviewId: string;
  agentSessionId: string;
  openingRunId: string;
  agentRunId: string;
  status: string;
  replayed: boolean;
};

export async function createInterview(input: {
  userId: string;
  idempotencyKey: string;
  request: unknown;
}, dependencies: {
  database?: typeof db;
  model?: string;
} = {}): Promise<CreateInterviewResult> {
  const idempotencyKey = creationIdempotencyKeySchema.parse(input.idempotencyKey);
  const request = createInterviewRequestSchema.parse(input.request);
  const requestHash = createInterviewRequestHash(request);
  const database = dependencies.database ?? db;

  return database.transaction(async (transaction) => {
    await lockInterviewCreationKey(transaction, input.userId, idempotencyKey);
    const existing = await findInterviewCreation(transaction, input.userId, idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new InterviewApplicationError(
          "INTERVIEW_IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound to a different interview request",
        );
      }
      if (!existing.openingRunId || !existing.agentRunId) {
        throw new Error("Existing interview creation is incomplete");
      }
      return {
        interviewId: existing.interviewId,
        agentSessionId: existing.agentSessionId,
        openingRunId: existing.openingRunId,
        agentRunId: existing.agentRunId,
        status: existing.status,
        replayed: true,
      };
    }

    const source = await loadOwnedResumeVersion(transaction, input.userId, request.resumeVersionId);
    if (!source) {
      throw new InterviewApplicationError(
        "RESUME_VERSION_NOT_FOUND",
        "Resume version was not found",
      );
    }
    if (source.parseStatus !== "parsed") {
      throw new InterviewApplicationError(
        "RESUME_VERSION_NOT_PARSED",
        "Resume version is not parsed",
      );
    }
    const parsed = parsedResumeSchema.safeParse(source.parsedJson);
    if (!parsed.success) {
      throw new InterviewApplicationError(
        "RESUME_VERSION_INVALID",
        "Parsed resume data is invalid",
      );
    }
    const canonicalText = serializeParsedResume(parsed.data);
    const evidenceJson = buildResumeEvidence(parsed.data);
    const model = dependencies.model ?? loadModelPolicy().fastModel;
    const creation = await insertInterviewCreation(transaction, {
      userId: input.userId,
      idempotencyKey,
      requestHash,
      request,
      model,
      promptVersion: INTERVIEW_AGENT_PROMPT_VERSION,
      systemPrompt: buildInterviewSystemPrompt(request),
      resume: {
        resumeId: source.resumeId,
        resumeTitle: source.resumeTitle,
        resumeVersionId: source.resumeVersionId,
        versionNumber: source.versionNumber,
        sourceType: source.sourceType,
        parsedJson: parsed.data,
        canonicalText,
        evidenceJson,
        contentHash: hashCanonical({ parsed: parsed.data, canonicalText }),
      },
    });
    await appendAgentEventsInTransaction(transaction, {
      sessionId: creation.session.id,
      runId: creation.agentRun.id,
      events: [{
        type: "interview/session_initialized",
        payload: {
          interviewId: creation.interview.id,
          openingRunId: creation.openingRun.id,
          status: creation.interview.status,
        },
        dedupeKey: `interview:session:${creation.interview.id}`,
        schemaVersion: 1,
        visibility: "model_and_user",
      }],
    });
    return {
      interviewId: creation.interview.id,
      agentSessionId: creation.session.id,
      openingRunId: creation.openingRun.id,
      agentRunId: creation.agentRun.id,
      status: creation.interview.status,
      replayed: false,
    };
  });
}
