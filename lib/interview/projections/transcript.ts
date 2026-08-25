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
}).strict();

const completedSchema = z.object({
  interviewId: z.string().uuid(),
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

  for (const event of input.events) {
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
      case "interview/completion_requested":
        completionRequestedSchema.parse(event.payload);
        break;
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
