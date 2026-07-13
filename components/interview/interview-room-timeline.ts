import type { RoomMessage } from "@/lib/interview/agent/room-state";

export type InterviewRoomTimelineGroup = {
  key: string;
  runId: string | null;
  beforeTurn: RoomMessage[];
  afterTurn: RoomMessage[];
};

export function buildInterviewRoomTimeline(messages: readonly RoomMessage[]): InterviewRoomTimelineGroup[] {
  const consumed = new Set<string>();

  return messages.flatMap((message): InterviewRoomTimelineGroup[] => {
    if (consumed.has(message.id)) return [];
    consumed.add(message.id);

    if (!message.runId) {
      return [{ key: message.id, runId: null, beforeTurn: [message], afterTurn: [] }];
    }

    if (message.role === "user") {
      const reply = messages.find((candidate) => (
        !consumed.has(candidate.id)
        && candidate.runId === message.runId
        && candidate.role === "assistant"
      ));
      if (reply) consumed.add(reply.id);

      return [{
        key: `turn:${message.runId}`,
        runId: message.runId,
        beforeTurn: [message],
        afterTurn: reply ? [reply] : [],
      }];
    }

    return [{
      key: `turn:${message.runId}`,
      runId: message.runId,
      beforeTurn: [],
      afterTurn: [message],
    }];
  });
}
