import { z } from "zod";
import { db } from "@/lib/db";
import { loadOwnedInterviewRoomData, type InterviewDatabase } from "../persistence/repository";
import { projectInterviewRoom } from "../projections/room";
import { projectInterviewTranscript } from "../projections/transcript";
import { projectTrajectory } from "@/lib/agent/trajectory-projection";
import type { AgentEventType, AgentEventVisibility } from "@/lib/agent/types";
import type { InterviewRoomQueryView } from "../projections/types";

const interviewSchema = z.object({
  id: z.string().uuid(),
  agentSessionId: z.string().uuid(),
  status: z.enum(["initializing", "active", "completing", "completed"]),
  answeredRoundCount: z.number().int().nonnegative(),
  targetRoundCount: z.number().int().positive(),
  resumeTitle: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
});

const questionSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  kind: z.enum(["main", "follow_up"]),
  topic: z.string(),
  question: z.string(),
  tip: z.string().nullable(),
  status: z.enum(["awaiting_answer", "answered", "skipped", "abandoned"]),
  resumeEvidenceIds: z.array(z.string()).optional(),
});

const runSchema = z.object({
  id: z.string().uuid(),
  triggerType: z.enum(["opening", "answer", "skip"]),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  agentRunStatus: z.enum(["queued", "running", "completed", "failed", "cancelled"]).nullable().optional(),
});

const completionJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "scoring", "reporting", "completed", "failed"]),
});

const eventSchema = z.object({
  runId: z.string().uuid().nullable(),
  sequence: z.number().int().positive(),
  type: z.string(),
  payload: z.unknown(),
  schemaVersion: z.number().int().positive(),
  visibility: z.enum(["model", "user", "model_and_user", "internal"]),
  createdAt: z.coerce.date().optional(),
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
  const snapshot = await getInterviewRoomEventSnapshot(input, dependencies);
  return snapshot?.view ?? null;
}

export async function getInterviewRoomEventSnapshot(input: {
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
} = {}): Promise<{ cursor: number; view: InterviewRoomQueryView } | null> {
  const data = await loadOwnedInterviewRoomData({
    database: dependencies.database ?? db,
    userId: input.userId,
    interviewId: input.interviewId,
  });
  if (!data) return null;

  const interview = interviewSchema.parse(data.interview);
  const currentQuestion = data.currentQuestion ? questionSchema.parse(data.currentQuestion) : null;
  const currentRun = data.currentRun ? runSchema.parse(data.currentRun) : null;
  const completionJob = data.completionJob ? completionJobSchema.parse(data.completionJob) : null;
  const events = z.array(eventSchema).parse(data.events);

  const room = projectInterviewRoom({ interview, currentQuestion, currentRun, completionJob });
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
    cursor: z.number().int().nonnegative().parse(data.eventCursor),
    view: {
      room,
      transcript: projectInterviewTranscript({ events }),
      trajectory: projectTrajectory(events.map((event) => ({
        id: event.sequence,
        sessionId: interview.agentSessionId,
        runId: event.runId,
        sequence: event.sequence,
        type: event.type as AgentEventType,
        payload: (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>,
        dedupeKey: null,
        schemaVersion: event.schemaVersion,
        visibility: event.visibility as AgentEventVisibility,
        createdAt: event.createdAt ?? new Date(0),
      })), {
        systemPrompt: interview.systemPrompt ?? undefined,
      }),
    },
  };
}
