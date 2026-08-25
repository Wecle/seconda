import { z } from "zod";
import type { InterviewRoomQueryView } from "../projections/types";

const questionSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  kind: z.enum(["main", "follow_up"]),
  topic: z.string(),
  content: z.string(),
  tip: z.string().nullable(),
}).strict();

const roomSchema = z.object({
  interviewId: z.string().uuid(),
  phase: z.enum([
    "initializing",
    "generating_question",
    "awaiting_answer",
    "evaluating_answer",
    "completing",
    "completed",
    "run_failed",
    "invalid_state",
  ]),
  currentQuestion: questionSchema.nullable(),
  currentRound: z.number().int().positive(),
  totalRounds: z.number().int().positive(),
  canSubmitAnswer: z.boolean(),
  canSkip: z.boolean(),
  canEnd: z.boolean(),
  retryableRunId: z.string().uuid().nullable(),
}).strict();

const transcriptItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reasoning"),
    runId: z.string().uuid(),
    step: z.number().int().positive(),
    attempt: z.number().int().positive(),
    blockIndex: z.number().int().nonnegative(),
    sequence: z.number().int().positive(),
    endSequence: z.number().int().positive(),
    content: z.string(),
    complete: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("question"),
    questionId: z.string().uuid(),
    sequence: z.number().int().positive(),
    kind: z.enum(["main", "follow_up"]),
    content: z.string(),
  }).strict(),
  z.object({
    type: z.literal("skill"),
    runId: z.string().uuid(),
    sequence: z.number().int().positive(),
    name: z.string(),
    status: z.enum(["loaded", "failed"]),
    version: z.string().nullable(),
    code: z.string().nullable(),
  }).strict(),
  z.object({
    type: z.literal("answer"),
    answerId: z.string().uuid(),
    questionId: z.string().uuid(),
    sequence: z.number().int().positive(),
    content: z.string(),
    skipped: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("closing"),
    sequence: z.number().int().positive(),
    content: z.string(),
  }).strict(),
]);

const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room"),
    view: z.object({
      room: roomSchema,
      transcript: z.array(transcriptItemSchema),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("complete"),
    ok: z.boolean(),
  }).strict(),
]);

export type InterviewOpeningStreamEvent =
  | { type: "room"; view: InterviewRoomQueryView }
  | { type: "complete"; ok: boolean };

export function parseInterviewRoomPayload(value: unknown): InterviewRoomQueryView | null {
  const parsed = z.object({
    room: roomSchema,
    transcript: z.array(transcriptItemSchema),
  }).strict().safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseInterviewOpeningSSEBlock(block: string): InterviewOpeningStreamEvent | null {
  const data = block.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = streamEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
