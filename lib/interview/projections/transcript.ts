import { z } from "zod";
import type {
  InterviewEventSnapshot,
  InterviewTranscriptItem,
} from "./types";

const sessionInitializedSchema = z.object({
  interviewId: z.string().uuid(),
  openingRunId: z.string().uuid(),
  status: z.literal("initializing"),
}).strict();

const questionCommittedSchema = z.object({
  interviewId: z.string().uuid(),
  questionId: z.string().uuid(),
  sequence: z.number().int().positive(),
  kind: z.enum(["main", "follow_up"]),
  topic: z.string(),
  question: z.string().min(1),
  tip: z.string().nullable(),
  resumeEvidenceIds: z.array(z.string()),
}).strict();

const answerSubmittedSchema = z.object({
  interviewId: z.string().uuid(),
  answerId: z.string().uuid(),
  questionId: z.string().uuid(),
  sequence: z.number().int().positive(),
  content: z.string(),
  skipped: z.boolean(),
}).strict();

const completionRequestedSchema = z.object({
  interviewId: z.string().uuid(),
  closingMessage: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const completedSchema = z.object({
  interviewId: z.string().uuid(),
}).strict();

const stepStartedSchema = z.object({
  step: z.number().int().positive(),
  attempt: z.number().int().positive(),
}).strict();

const assistantChunkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("block-start"),
    index: z.number().int().nonnegative(),
    blockType: z.enum(["text", "reasoning"]),
  }).strict(),
  z.object({
    type: z.enum(["text-delta", "reasoning-delta"]),
    index: z.number().int().nonnegative(),
    text: z.string(),
  }).strict(),
  z.object({
    type: z.literal("block-end"),
    index: z.number().int().nonnegative(),
    blockType: z.enum(["text", "reasoning"]),
  }).strict(),
]);

const assistantChunkPayloadSchema = z.object({
  chunk: assistantChunkSchema,
}).strict();

const skillLoadedSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().min(1).max(64),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

const skillLoadFailedSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100),
}).strict();

function assertOrderedEvents(events: readonly InterviewEventSnapshot[]) {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!Number.isInteger(event.sequence) || event.sequence <= 0) {
      throw new Error("Interview event sequence must be a positive integer");
    }
    if (index > 0 && events[index - 1].sequence >= event.sequence) {
      throw new Error("Interview events must have unique ascending sequences");
    }
  }
}

export function projectInterviewTranscript(input: {
  events: readonly InterviewEventSnapshot[];
}): InterviewTranscriptItem[] {
  assertOrderedEvents(input.events);
  const transcript: InterviewTranscriptItem[] = [];
  const currentStepByRun = new Map<string, { step: number; attempt: number }>();
  const reasoningIndexByBlock = new Map<string, number>();

  for (const event of input.events) {
    if (event.type === "skill_loaded" || event.type === "skill_load_failed") {
      if (event.visibility !== "model" || event.schemaVersion !== 1 || !event.runId) {
        throw new Error("Interview skill event must use the supported private lifecycle schema");
      }
      if (event.type === "skill_loaded") {
        const payload = skillLoadedSchema.parse(event.payload);
        transcript.push({
          type: "skill",
          runId: event.runId,
          sequence: event.sequence,
          name: payload.name,
          status: "loaded",
          version: payload.version,
          code: null,
        });
      } else {
        const payload = skillLoadFailedSchema.parse(event.payload);
        transcript.push({
          type: "skill",
          runId: event.runId,
          sequence: event.sequence,
          name: payload.name,
          status: "failed",
          version: null,
          code: payload.code,
        });
      }
      continue;
    }
    if (event.type === "step_started") {
      if (event.visibility !== "model" || event.schemaVersion !== 1) {
        throw new Error("Interview step event must use the supported private reasoning schema");
      }
      if (!event.runId) throw new Error("Interview step event must belong to a run");
      currentStepByRun.set(event.runId, stepStartedSchema.parse(event.payload));
      continue;
    }
    if (event.type === "assistant_chunk") {
      if (event.visibility !== "model" || event.schemaVersion !== 1) {
        throw new Error("Interview reasoning event must use the supported private reasoning schema");
      }
      const { chunk } = assistantChunkPayloadSchema.parse(event.payload);
      if (chunk.type === "text-delta") continue;
      if ((chunk.type === "block-start" || chunk.type === "block-end") && chunk.blockType === "text") {
        continue;
      }
      if (!event.runId) throw new Error("Interview reasoning event must belong to a run");
      const currentStep = currentStepByRun.get(event.runId);
      if (!currentStep) throw new Error("Interview reasoning event must follow a step start");
      const blockKey = `${event.runId}:${currentStep.step}:${currentStep.attempt}:${chunk.index}`;
      const existingIndex = reasoningIndexByBlock.get(blockKey);

      if (chunk.type === "block-start") {
        if (existingIndex !== undefined) throw new Error("Interview reasoning block cannot start twice");
        reasoningIndexByBlock.set(blockKey, transcript.length);
        transcript.push({
          type: "reasoning",
          runId: event.runId,
          step: currentStep.step,
          attempt: currentStep.attempt,
          blockIndex: chunk.index,
          sequence: event.sequence,
          endSequence: event.sequence,
          content: "",
          complete: false,
        });
        continue;
      }

      if (existingIndex === undefined) throw new Error("Interview reasoning block is missing its start");
      const existing = transcript[existingIndex];
      if (existing.type !== "reasoning" || existing.complete) {
        throw new Error("Interview reasoning block is already complete");
      }
      transcript[existingIndex] = chunk.type === "reasoning-delta"
        ? {
            ...existing,
            content: existing.content + chunk.text,
            endSequence: event.sequence,
          }
        : {
            ...existing,
            complete: true,
            endSequence: event.sequence,
          };
      continue;
    }

    if (event.visibility !== "user" && event.visibility !== "model_and_user") {
      continue;
    }
    if (!event.type.startsWith("interview/")) continue;
    if (event.schemaVersion !== 1) {
      throw new Error(`Unsupported public interview event schema: ${event.type}@${event.schemaVersion}`);
    }

    switch (event.type) {
      case "interview/session_initialized":
        sessionInitializedSchema.parse(event.payload);
        break;
      case "interview/question_committed": {
        const payload = questionCommittedSchema.parse(event.payload);
        transcript.push({
          type: "question",
          questionId: payload.questionId,
          sequence: payload.sequence,
          kind: payload.kind,
          content: payload.question,
        });
        break;
      }
      case "interview/answer_submitted": {
        const payload = answerSubmittedSchema.parse(event.payload);
        transcript.push({
          type: "answer",
          answerId: payload.answerId,
          questionId: payload.questionId,
          sequence: payload.sequence,
          content: payload.content,
          skipped: payload.skipped,
        });
        break;
      }
      case "interview/completion_requested": {
        const payload = completionRequestedSchema.parse(event.payload);
        if (payload.closingMessage) {
          transcript.push({
            type: "closing",
            sequence: event.sequence,
            content: payload.closingMessage,
          });
        }
        break;
      }
      case "interview/completed":
        completedSchema.parse(event.payload);
        break;
      case "interview/answer_analyzed":
        throw new Error("Internal answer analysis cannot appear in a public transcript");
      default:
        throw new Error(`Unsupported public interview event: ${event.type}`);
    }
  }

  return transcript;
}
