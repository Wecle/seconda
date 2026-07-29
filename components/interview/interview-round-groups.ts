import type { RoomMessage } from "@/lib/interview/agent/client/room-state";

const questionKinds = new Set(["opening", "question", "clarification"]);

export type InterviewQuestionAnswerGroup = {
  id: string;
  question: RoomMessage;
  answer: RoomMessage | null;
};

export function buildInterviewQuestionAnswerGroups(
  messages: readonly RoomMessage[],
): InterviewQuestionAnswerGroup[] {
  const groups: InterviewQuestionAnswerGroup[] = [];
  let current: InterviewQuestionAnswerGroup | null = null;

  for (const message of messages) {
    if (message.role === "assistant" && questionKinds.has(message.kind)) {
      current = {
        id: `question-answer:${message.id}`,
        question: message,
        answer: null,
      };
      groups.push(current);
      continue;
    }

    if (
      message.role === "user"
      && message.kind === "answer"
      && current
      && !current.answer
    ) {
      current.answer = message;
    }
  }

  return groups;
}

export function visibleGroupIds(
  groups: readonly InterviewQuestionAnswerGroup[],
  visibleMessageIds: ReadonlySet<string>,
): Set<string> {
  return new Set(groups.flatMap((group) => (
    visibleMessageIds.has(group.question.id)
    || Boolean(group.answer && visibleMessageIds.has(group.answer.id))
      ? [group.id]
      : []
  )));
}
