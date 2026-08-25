export type InterviewTranscriptItem =
  | {
      type: "question";
      questionId: string;
      sequence: number;
      kind: "main" | "follow_up";
      content: string;
    }
  | {
      type: "answer";
      answerId: string;
      questionId: string;
      sequence: number;
      content: string;
      skipped: boolean;
    };

export type InterviewRoomPhase =
  | "initializing"
  | "generating_question"
  | "awaiting_answer"
  | "evaluating_answer"
  | "completing"
  | "completed"
  | "run_failed"
  | "invalid_state";

export interface InterviewQuestionView {
  id: string;
  sequence: number;
  kind: "main" | "follow_up";
  topic: string;
  content: string;
  tip: string | null;
}

export interface InterviewRoomView {
  interviewId: string;
  phase: InterviewRoomPhase;
  currentQuestion: InterviewQuestionView | null;
  currentRound: number;
  totalRounds: number;
  canSubmitAnswer: boolean;
  canSkip: boolean;
  canEnd: boolean;
  retryableRunId: string | null;
}

export interface InterviewEventSnapshot {
  sequence: number;
  type: string;
  payload: unknown;
  schemaVersion: number;
  visibility: "model" | "user" | "model_and_user" | "internal";
}

export interface InterviewSnapshot {
  id: string;
  status: "initializing" | "active" | "completing" | "completed";
  answeredRoundCount: number;
  targetRoundCount: number;
}

export interface InterviewQuestionSnapshot {
  id: string;
  sequence: number;
  kind: "main" | "follow_up";
  topic: string;
  question: string;
  tip: string | null;
  status: "awaiting_answer" | "answered" | "skipped" | "abandoned";
}

export interface InterviewRunSnapshot {
  id: string;
  triggerType: "opening" | "answer" | "skip";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
}

export interface InterviewRoomQueryView {
  room: InterviewRoomView;
  transcript: InterviewTranscriptItem[];
}
