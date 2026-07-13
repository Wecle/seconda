import {
  publicAgentEventPayloadSchemas,
  publicAgentEventTypeSchema,
  type CommittedArtifact,
  type CommittedInterviewMessage,
  type PublicAgentEventType,
} from "./contracts";

export type RoomMessage = {
  id: string;
  sequence: number | null;
  runId?: string | null;
  role: string;
  kind: string;
  content: string;
  status?: "sending" | "sent" | "failed";
};

export type ReasoningEntry = {
  entryId: string;
  attemptId: string;
  kind: "reasoning" | "tool";
  text: string;
  status: "streaming" | "completed";
  discarded: boolean;
};

export type LiveTurnState = {
  runId: string;
  logicalMessageId: string | null;
  currentAttemptId: string | null;
  phase: "reasoning" | "responding" | "committing" | "failed";
  reasoningEntries: ReasoningEntry[];
  thinking: { expanded: boolean; userToggled: boolean; failed: boolean };
  provisionalResponse: string;
  responseStarted: boolean;
  lastSequence: number;
};

export type RoomTurn = LiveTurnState & {
  artifacts: CommittedArtifact[];
};

export type AgentRoomState = { messages: RoomMessage[]; turns: Record<string, RoomTurn> };
export type PublicRoomEvent = {
  id?: string;
  runId: string;
  sequence: number;
  type: PublicAgentEventType | (string & {});
  visibility?: "public";
  attemptId?: string | null;
  logicalMessageId?: string | null;
  payload: unknown;
  createdAt?: string | Date;
};

type SequencedAction = { sequence?: number };

export type AgentRoomAction =
  | { type: "candidate_submitted"; localId: string; content: string }
  | { type: "candidate_committed"; localId: string; runId: string; message: { id: string; sequence: number; content: string } }
  | { type: "candidate_failed"; localId: string }
  | { type: "candidate_retrying"; localId: string }
  | { type: "messages_refreshed"; messages: RoomMessage[] }
  | ({ type: "run_accepted"; runId: string; logicalMessageId?: string | null } & SequencedAction)
  | ({ type: "run_started"; runId: string; logicalMessageId: string | null } & SequencedAction)
  | ({ type: "phase_changed"; runId: string; attemptId: string | null; phase: string } & SequencedAction)
  | ({ type: "attempt_started"; runId: string; attemptId: string; logicalMessageId: string } & SequencedAction)
  | ({ type: "attempt_discarded"; runId: string; attemptId: string; logicalMessageId: string; reason: string } & SequencedAction)
  | ({ type: "reasoning_started"; runId: string; attemptId: string; entryId?: string } & SequencedAction)
  | ({ type: "reasoning_delta"; runId: string; attemptId: string; entryId: string; text: string } & SequencedAction)
  | ({ type: "reasoning_completed"; runId: string; attemptId: string; entryId: string } & SequencedAction)
  | ({ type: "tool_call_started" | "tool_call_completed"; runId: string; attemptId: string; toolCallId: string; publicLabel: string } & SequencedAction)
  | ({ type: "proposal_authorized"; runId: string; attemptId: string; logicalMessageId: string } & SequencedAction)
  | ({ type: "response_started"; runId: string; attemptId: string; logicalMessageId: string } & SequencedAction)
  | ({ type: "response_delta"; runId: string; attemptId: string; logicalMessageId: string; text: string; provisional: true } & SequencedAction)
  | ({ type: "response_finished"; runId: string; attemptId: string; logicalMessageId: string } & SequencedAction)
  | ({ type: "response_discarded"; runId: string; attemptId: string; logicalMessageId: string; reason: string } & SequencedAction)
  | ({ type: "thinking_toggled"; runId: string; expanded: boolean } & SequencedAction)
  | ({ type: "artifact_committed"; artifact: CommittedArtifact } & SequencedAction)
  | ({ type: "scoring_progress"; runId: string } & SequencedAction)
  | ({ type: "reporting_started"; runId: string } & SequencedAction)
  | ({ type: "message_committed"; runId: string; attemptId: string; logicalMessageId: string; message: CommittedInterviewMessage } & SequencedAction)
  | ({ type: "run_completed"; runId: string } & SequencedAction)
  | ({ type: "run_failed"; runId: string } & SequencedAction);

export function initialAgentRoomState(
  messages: RoomMessage[] = [],
  artifacts: CommittedArtifact[] = [],
  events: PublicRoomEvent[] = [],
): AgentRoomState {
  let state: AgentRoomState = { messages: [...messages], turns: {} };
  for (const artifact of artifacts) state = agentRoomReducer(state, { type: "artifact_committed", artifact });
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const action = roomActionFromEvent(event);
    if (action) state = agentRoomReducer(state, action);
  }
  for (const message of messages) {
    if (message.role !== "assistant" || !message.runId) continue;
    state = updateTurn(state, message.runId, undefined, (turn) => ({
      ...turn,
      logicalMessageId: message.id,
      phase: "committing",
      provisionalResponse: "",
      responseStarted: true,
      thinking: { ...turn.thinking, expanded: false, failed: false },
    }));
  }
  return state;
}

export function agentRoomReducer(state: AgentRoomState, action: AgentRoomAction): AgentRoomState {
  switch (action.type) {
    case "candidate_submitted":
      if (state.messages.some((message) => message.id === action.localId)) return state;
      return { ...state, messages: [...state.messages, { id: action.localId, sequence: null, role: "user", kind: "answer", content: action.content, status: "sending" }] };
    case "candidate_committed": {
      const alreadyDurable = state.messages.some((message) => message.id === action.message.id && message.id !== action.localId);
      return {
        ...ensureTurn(state, action.runId),
        messages: alreadyDurable
          ? state.messages.filter((message) => message.id !== action.localId)
          : state.messages.map((message) => message.id === action.localId
            ? { ...message, ...action.message, runId: action.runId, status: "sent" }
            : message),
      };
    }
    case "candidate_failed":
      return { ...state, messages: state.messages.map((message) => message.id === action.localId ? { ...message, status: "failed" } : message) };
    case "candidate_retrying":
      return { ...state, messages: state.messages.map((message) => message.id === action.localId ? { ...message, status: "sending" } : message) };
    case "messages_refreshed": {
      const merged = new Map(state.messages.filter((message) => message.sequence !== null).map((message) => [message.id, message]));
      for (const message of action.messages) merged.set(message.id, message);
      const durable = [...merged.values()].sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
      const pending = state.messages.filter((message) => message.sequence === null && !merged.has(message.id));
      return { ...state, messages: [...durable, ...pending] };
    }
    case "run_accepted":
    case "run_started":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        logicalMessageId: action.logicalMessageId ?? turn.logicalMessageId,
      }));
    case "phase_changed":
    case "scoring_progress":
    case "reporting_started":
      return updateTurn(state, action.runId, action.sequence, (turn) => turn);
    case "attempt_started":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        currentAttemptId: action.attemptId,
        logicalMessageId: action.logicalMessageId,
        phase: "reasoning",
        provisionalResponse: "",
        responseStarted: false,
        thinking: { ...turn.thinking, failed: false },
      }));
    case "attempt_discarded":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        phase: "reasoning",
        reasoningEntries: turn.reasoningEntries.map((entry) => entry.attemptId === action.attemptId
          ? { ...entry, status: "completed", discarded: true }
          : entry),
        provisionalResponse: turn.currentAttemptId === action.attemptId ? "" : turn.provisionalResponse,
        responseStarted: turn.currentAttemptId === action.attemptId ? false : turn.responseStarted,
      }));
    case "reasoning_started":
      return updateTurn(state, action.runId, action.sequence, (turn) => {
        const entryId = action.entryId ?? `reasoning:${action.attemptId}`;
        return {
          ...turn,
          currentAttemptId: action.attemptId,
          phase: "reasoning",
          reasoningEntries: upsertReasoningEntry(turn.reasoningEntries, {
            entryId,
            attemptId: action.attemptId,
            kind: "reasoning",
            text: "",
            status: "streaming",
            discarded: false,
          }),
          thinking: {
            ...turn.thinking,
            expanded: turn.thinking.userToggled ? turn.thinking.expanded : true,
            failed: false,
          },
        };
      });
    case "reasoning_delta":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        currentAttemptId: action.attemptId,
        reasoningEntries: appendReasoningDelta(turn.reasoningEntries, action),
      }));
    case "reasoning_completed":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        reasoningEntries: turn.reasoningEntries.map((entry) => entry.entryId === action.entryId && entry.attemptId === action.attemptId
          ? { ...entry, status: "completed" }
          : entry),
      }));
    case "tool_call_started":
    case "tool_call_completed":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        currentAttemptId: action.attemptId,
        reasoningEntries: upsertReasoningEntry(turn.reasoningEntries, {
          entryId: `tool:${action.toolCallId}`,
          attemptId: action.attemptId,
          kind: "tool",
          text: action.publicLabel,
          status: action.type === "tool_call_completed" ? "completed" : "streaming",
          discarded: false,
        }),
      }));
    case "proposal_authorized":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        currentAttemptId: action.attemptId,
        logicalMessageId: action.logicalMessageId,
      }));
    case "thinking_toggled":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        thinking: { ...turn.thinking, expanded: action.expanded, userToggled: true },
      }));
    case "artifact_committed":
      return updateTurn(state, action.artifact.runId, action.sequence, (turn) => ({
        ...turn,
        artifacts: [...turn.artifacts.filter((artifact) => artifact.artifactId !== action.artifact.artifactId), action.artifact],
      }));
    case "response_started":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        currentAttemptId: action.attemptId,
        logicalMessageId: action.logicalMessageId,
        responseStarted: true,
        phase: "responding",
        thinking: { ...turn.thinking, expanded: false },
      }));
    case "response_delta":
      return updateTurn(state, action.runId, action.sequence, (turn) => {
        if (!turn.responseStarted || turn.currentAttemptId !== action.attemptId || turn.logicalMessageId !== action.logicalMessageId) return turn;
        return {
          ...turn,
          provisionalResponse: turn.provisionalResponse + action.text,
        };
      });
    case "response_finished":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({ ...turn, phase: "committing" }));
    case "response_discarded":
      return updateTurn(state, action.runId, action.sequence, (turn) => {
        if (turn.currentAttemptId !== action.attemptId || turn.logicalMessageId !== action.logicalMessageId) return turn;
        return {
          ...turn,
          phase: "reasoning",
          reasoningEntries: turn.reasoningEntries.map((entry) => entry.attemptId === action.attemptId
            ? { ...entry, status: "completed", discarded: true }
            : entry),
          provisionalResponse: "",
          responseStarted: false,
        };
      });
    case "message_committed": {
      const withTurn = ensureTurn(state, action.runId);
      const turn = withTurn.turns[action.runId];
      if (isDuplicateSequence(turn, action.sequence)) return state;
      const nextTurn = withSequence({
        ...turn,
        phase: "committing",
        provisionalResponse: "",
      }, action.sequence);
      return {
        ...withTurn,
        messages: upsertCommittedMessage(withTurn.messages, action.message),
        turns: { ...withTurn.turns, [action.runId]: nextTurn },
      };
    }
    case "run_completed":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({ ...turn, phase: "committing", provisionalResponse: "" }));
    case "run_failed":
      return updateTurn(state, action.runId, action.sequence, (turn) => ({
        ...turn,
        phase: "failed",
        provisionalResponse: "",
        responseStarted: false,
        thinking: { ...turn.thinking, expanded: true, failed: true },
      }));
  }
}

function roomActionFromEvent(event: PublicRoomEvent): AgentRoomAction | null {
  const parsedType = publicAgentEventTypeSchema.safeParse(event.type);
  if (!parsedType.success) return null;
  const parsedPayload = publicAgentEventPayloadSchemas[parsedType.data].safeParse(event.payload);
  if (!parsedPayload.success) return null;
  if (parsedPayload.data.runId !== event.runId) return null;
  const payload = parsedPayload.data as Record<string, unknown>;
  if (parsedType.data === "artifact_committed") {
    return { type: "artifact_committed", artifact: parsedPayload.data as CommittedArtifact, sequence: event.sequence };
  }
  if (parsedType.data === "message_committed") {
    const committed = parsedPayload.data as { runId: string; attemptId: string; logicalMessageId: string; message: CommittedInterviewMessage };
    return { type: "message_committed", ...committed, sequence: event.sequence };
  }
  return { type: parsedType.data, ...payload, sequence: event.sequence } as AgentRoomAction;
}

function ensureTurn(state: AgentRoomState, runId: string): AgentRoomState {
  if (state.turns[runId]) return state;
  return { ...state, turns: { ...state.turns, [runId]: createTurn(runId) } };
}

function updateTurn(
  state: AgentRoomState,
  runId: string,
  sequence: number | undefined,
  update: (turn: RoomTurn) => RoomTurn,
): AgentRoomState {
  const withTurn = ensureTurn(state, runId);
  const turn = withTurn.turns[runId];
  if (isDuplicateSequence(turn, sequence)) return state;
  const updated = withSequence(update(turn), sequence);
  if (updated === turn) return withTurn;
  return { ...withTurn, turns: { ...withTurn.turns, [runId]: updated } };
}

function isDuplicateSequence(turn: RoomTurn, sequence: number | undefined) {
  return sequence !== undefined && sequence <= turn.lastSequence;
}

function withSequence(turn: RoomTurn, sequence: number | undefined): RoomTurn {
  if (sequence === undefined || sequence === turn.lastSequence) return turn;
  return { ...turn, lastSequence: sequence };
}

function createTurn(runId: string): RoomTurn {
  return {
    runId,
    logicalMessageId: null,
    currentAttemptId: null,
    phase: "reasoning",
    reasoningEntries: [],
    thinking: { expanded: true, userToggled: false, failed: false },
    artifacts: [],
    provisionalResponse: "",
    responseStarted: false,
    lastSequence: 0,
  };
}

function upsertReasoningEntry(entries: ReasoningEntry[], next: ReasoningEntry): ReasoningEntry[] {
  const index = entries.findIndex((entry) => entry.entryId === next.entryId && entry.attemptId === next.attemptId);
  if (index < 0) return [...entries, next];
  return entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...next } : entry);
}

function appendReasoningDelta(
  entries: ReasoningEntry[],
  action: Extract<AgentRoomAction, { type: "reasoning_delta" }>,
): ReasoningEntry[] {
  const existing = entries.find((entry) => entry.entryId === action.entryId && entry.attemptId === action.attemptId);
  return upsertReasoningEntry(entries, {
    entryId: action.entryId,
    attemptId: action.attemptId,
    kind: "reasoning",
    text: (existing?.text ?? "") + action.text,
    status: "streaming",
    discarded: existing?.discarded ?? false,
  });
}

function upsertCommittedMessage(messages: RoomMessage[], message: CommittedInterviewMessage): RoomMessage[] {
  const authoritative: RoomMessage = { ...message };
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, authoritative].sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
  return messages.map((candidate, messageIndex) => messageIndex === index ? authoritative : candidate);
}
