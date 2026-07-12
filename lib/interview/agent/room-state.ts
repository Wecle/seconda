import type { CommittedArtifact, PublicThinkingEntry } from "./contracts";

export type RoomMessage = {
  id: string;
  sequence: number | null;
  runId?: string | null;
  role: string;
  kind: string;
  content: string;
  status?: "sending" | "sent" | "failed";
};

export type RoomTurn = {
  runId: string;
  thinking: { mode: "auto" | "manual"; expanded: boolean; entries: PublicThinkingEntry[]; failed: boolean };
  artifacts: CommittedArtifact[];
  responseStarted: boolean;
  messageId: string | null;
  provisional: string;
};

export type AgentRoomState = { messages: RoomMessage[]; turns: Record<string, RoomTurn> };
export type AgentRoomAction =
  | { type: "candidate_submitted"; localId: string; content: string }
  | { type: "candidate_committed"; localId: string; runId: string; message: { id: string; sequence: number; content: string } }
  | { type: "candidate_failed"; localId: string }
  | { type: "messages_refreshed"; messages: RoomMessage[] }
  | { type: "run_accepted"; runId: string }
  | { type: "thinking_toggled"; runId: string; expanded: boolean }
  | { type: "thinking_summary"; entry: PublicThinkingEntry }
  | { type: "artifact_committed"; artifact: CommittedArtifact }
  | { type: "response_started"; runId: string; messageId: string }
  | { type: "provisional_delta"; runId: string; messageId: string; text: string }
  | { type: "message_committed"; runId: string }
  | { type: "run_failed"; runId: string };

export function initialAgentRoomState(messages: RoomMessage[] = [], artifacts: CommittedArtifact[] = []): AgentRoomState {
  let state: AgentRoomState = { messages, turns: {} };
  for (const artifact of artifacts) state = agentRoomReducer(state, { type: "artifact_committed", artifact });
  return state;
}

export function agentRoomReducer(state: AgentRoomState, action: AgentRoomAction): AgentRoomState {
  switch (action.type) {
    case "candidate_submitted":
      return { ...state, messages: [...state.messages, { id: action.localId, sequence: null, role: "user", kind: "answer", content: action.content, status: "sending" }] };
    case "candidate_committed":
      return {
        ...ensureTurn(state, action.runId),
        messages: state.messages.map((message) => message.id === action.localId
          ? { ...message, ...action.message, runId: action.runId, status: "sent" }
          : message),
      };
    case "candidate_failed":
      return { ...state, messages: state.messages.map((message) => message.id === action.localId ? { ...message, status: "failed" } : message) };
    case "messages_refreshed": {
      const merged = new Map(state.messages.filter((message) => message.sequence !== null).map((message) => [message.id, message]));
      for (const message of action.messages) merged.set(message.id, message);
      const durable = [...merged.values()].sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER));
      const pending = state.messages.filter((message) => message.sequence === null && !merged.has(message.id));
      return { ...state, messages: [...durable, ...pending] };
    }
    case "run_accepted": return ensureTurn(state, action.runId);
    case "thinking_toggled": return updateTurn(state, action.runId, (turn) => ({ ...turn, thinking: { ...turn.thinking, mode: "manual", expanded: action.expanded } }));
    case "thinking_summary": return updateTurn(state, action.entry.runId, (turn) => ({
      ...turn,
      thinking: { ...turn.thinking, entries: [...turn.thinking.entries.filter((entry) => entry.entryId !== action.entry.entryId), action.entry] },
    }));
    case "artifact_committed": return updateTurn(state, action.artifact.runId, (turn) => ({
      ...turn,
      artifacts: [...turn.artifacts.filter((artifact) => artifact.artifactId !== action.artifact.artifactId), action.artifact],
    }));
    case "response_started": return updateTurn(state, action.runId, (turn) => ({
      ...turn,
      responseStarted: true,
      messageId: action.messageId,
      thinking: { ...turn.thinking, expanded: turn.thinking.mode === "auto" ? false : turn.thinking.expanded },
    }));
    case "provisional_delta": return updateTurn(state, action.runId, (turn) => {
      if (!turn.responseStarted || turn.messageId !== action.messageId) return turn;
      return { ...turn, provisional: turn.provisional + action.text };
    });
    case "message_committed": return updateTurn(state, action.runId, (turn) => ({ ...turn, provisional: "" }));
    case "run_failed": return updateTurn(state, action.runId, (turn) => ({
      ...turn,
      provisional: "",
      thinking: { ...turn.thinking, expanded: true, failed: true },
    }));
  }
}

function ensureTurn(state: AgentRoomState, runId: string): AgentRoomState {
  if (state.turns[runId]) return state;
  return { ...state, turns: { ...state.turns, [runId]: createTurn(runId) } };
}

function updateTurn(state: AgentRoomState, runId: string, update: (turn: RoomTurn) => RoomTurn) {
  const withTurn = ensureTurn(state, runId);
  return { ...withTurn, turns: { ...withTurn.turns, [runId]: update(withTurn.turns[runId]) } };
}

function createTurn(runId: string): RoomTurn {
  return {
    runId,
    thinking: { mode: "auto", expanded: true, entries: [], failed: false },
    artifacts: [],
    responseStarted: false,
    messageId: null,
    provisional: "",
  };
}
