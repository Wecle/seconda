import type { CommittedArtifact, PublicThinkingEntry } from "./contracts";

export type RoomMessage = { id: string; sequence: number | null; role: string; kind: string; content: string; status?: "sending" | "sent" | "failed" };
export type AgentRoomState = {
  messages: RoomMessage[];
  provisional: string;
  thinking: { runId: string | null; mode: "auto" | "manual"; expanded: boolean; entries: PublicThinkingEntry[]; failed: boolean };
  artifacts: CommittedArtifact[];
};
export type AgentRoomAction =
  | { type: "candidate_submitted"; localId: string; content: string }
  | { type: "candidate_committed"; localId: string; message: { id: string; sequence: number; content: string } }
  | { type: "candidate_failed"; localId: string }
  | { type: "messages_refreshed"; messages: RoomMessage[] }
  | { type: "run_accepted"; runId: string }
  | { type: "thinking_toggled"; expanded: boolean }
  | { type: "thinking_summary"; entry: PublicThinkingEntry }
  | { type: "artifact_committed"; artifact: CommittedArtifact }
  | { type: "provisional_delta"; text: string }
  | { type: "message_committed" }
  | { type: "run_failed" };

export function initialAgentRoomState(messages: RoomMessage[] = [], artifacts: CommittedArtifact[] = []): AgentRoomState {
  return { messages, provisional: "", thinking: { runId: null, mode: "auto", expanded: false, entries: [], failed: false }, artifacts: dedupeArtifacts(artifacts) };
}

export function agentRoomReducer(state: AgentRoomState, action: AgentRoomAction): AgentRoomState {
  switch (action.type) {
    case "candidate_submitted":
      return { ...state, messages: [...state.messages, { id: action.localId, sequence: null, role: "user", kind: "answer", content: action.content, status: "sending" }] };
    case "candidate_committed":
      return { ...state, messages: state.messages.map((message) => message.id === action.localId ? { ...message, ...action.message, status: "sent" } : message) };
    case "candidate_failed":
      return { ...state, messages: state.messages.map((message) => message.id === action.localId ? { ...message, status: "failed" } : message) };
    case "messages_refreshed": {
      const merged = new Map(state.messages.filter((message) => message.sequence !== null).map((message) => [message.id, message]));
      for (const message of action.messages) merged.set(message.id, message);
      const durable = [...merged.values()].sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER));
      const pending = state.messages.filter((message) => message.sequence === null && !merged.has(message.id));
      return { ...state, messages: [...durable, ...pending] };
    }
    case "run_accepted":
      return { ...state, provisional: "", thinking: { runId: action.runId, mode: "auto", expanded: true, entries: [], failed: false } };
    case "thinking_toggled":
      return { ...state, thinking: { ...state.thinking, mode: "manual", expanded: action.expanded } };
    case "thinking_summary":
      return { ...state, thinking: { ...state.thinking, entries: [...state.thinking.entries.filter((entry) => entry.entryId !== action.entry.entryId), action.entry] } };
    case "artifact_committed":
      return { ...state, artifacts: [...state.artifacts.filter((item) => item.artifactId !== action.artifact.artifactId), action.artifact] };
    case "provisional_delta": return { ...state, provisional: state.provisional + action.text };
    case "message_committed": return { ...state, provisional: "", thinking: { ...state.thinking, expanded: state.thinking.mode === "auto" ? false : state.thinking.expanded } };
    case "run_failed": return { ...state, provisional: "", thinking: { ...state.thinking, expanded: true, failed: true } };
  }
}

function dedupeArtifacts(artifacts: CommittedArtifact[]) {
  return [...new Map(artifacts.map((artifact) => [artifact.artifactId, artifact])).values()];
}
