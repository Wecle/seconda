import { z } from "zod";
import { db } from "@/lib/db";
import { loadOwnedInterviewRoomData, type InterviewDatabase } from "../persistence/repository";
import { projectInterviewRoom } from "../projections/room";
import { projectInterviewTranscript } from "../projections/transcript";
import type { InterviewRoomQueryView } from "../projections/types";

const interviewSchema = z.object({
  id: z.string().uuid(),
  agentSessionId: z.string().uuid(),
  status: z.enum(["initializing", "active", "completing", "completed"]),
  answeredRoundCount: z.number().int().nonnegative(),
  targetRoundCount: z.number().int().positive(),
});

const questionSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  kind: z.enum(["main", "follow_up"]),
  topic: z.string(),
  question: z.string(),
  tip: z.string().nullable(),
  status: z.enum(["awaiting_answer", "answered", "skipped", "abandoned"]),
});

const runSchema = z.object({
  id: z.string().uuid(),
  triggerType: z.enum(["opening", "answer", "skip"]),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  agentRunStatus: z.enum(["queued", "running", "completed", "failed", "cancelled"]).nullable().optional(),
});

const eventSchema = z.object({
  runId: z.string().uuid().nullable(),
  sequence: z.number().int().positive(),
  type: z.string(),
  payload: z.unknown(),
  schemaVersion: z.number().int().positive(),
  visibility: z.enum(["model", "user", "model_and_user", "internal"]),
});

export async function getInterviewRoom(input: {
  userId: string;
  interviewId: string;
}, dependencies: {
  database?: InterviewDatabase;
  recordInvalidState?: (details: {
    interviewId: string;
    interviewStatus: string;
    questionId: string | null;
    questionStatus: string | null;
    runId: string | null;
    runStatus: string | null;
  }) => void;
} = {}): Promise<InterviewRoomQueryView | null> {
  const data = await loadOwnedInterviewRoomData({
    database: dependencies.database ?? db,
    userId: input.userId,
    interviewId: input.interviewId,
  });
  if (!data) return null;

  const interview = interviewSchema.parse(data.interview);
  const currentQuestion = data.currentQuestion ? questionSchema.parse(data.currentQuestion) : null;
  const currentRun = data.currentRun ? runSchema.parse(data.currentRun) : null;
  const events = z.array(eventSchema).parse(data.events);

  const room = projectInterviewRoom({ interview, currentQuestion, currentRun });
  if (room.phase === "invalid_state") {
    const details = {
      interviewId: interview.id,
      interviewStatus: interview.status,
      questionId: currentQuestion?.id ?? null,
      questionStatus: currentQuestion?.status ?? null,
      runId: currentRun?.id ?? null,
      runStatus: currentRun?.status ?? null,
    };
    if (dependencies.recordInvalidState) {
      dependencies.recordInvalidState(details);
    } else {
      console.error("Invalid interview room state", details);
    }
  }

  return {
    room,
    transcript: projectInterviewTranscript({ events }),
  };
}
