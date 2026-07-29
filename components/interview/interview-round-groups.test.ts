import assert from "node:assert/strict";
import test from "node:test";
import type { RoomMessage } from "@/lib/interview/agent/client/room-state";
import {
  buildInterviewQuestionAnswerGroups,
  visibleGroupIds,
} from "./interview-round-groups";

function message(
  id: string,
  role: "assistant" | "user",
  kind: RoomMessage["kind"],
  content = id,
): RoomMessage {
  return { id, sequence: 1, role, kind, content };
}

test("pairs each interview question with the following candidate answer", () => {
  const groups = buildInterviewQuestionAnswerGroups([
    message("opening", "assistant", "opening"),
    message("answer-1", "user", "answer"),
    message("question-2", "assistant", "question"),
    message("answer-2", "user", "answer"),
  ]);

  assert.deepEqual(groups.map((group) => ({
    id: group.id,
    questionId: group.question.id,
    answerId: group.answer?.id ?? null,
  })), [
    { id: "question-answer:opening", questionId: "opening", answerId: "answer-1" },
    { id: "question-answer:question-2", questionId: "question-2", answerId: "answer-2" },
  ]);
});

test("keeps clarification and unanswered questions while ignoring orphan answers and finish messages", () => {
  const groups = buildInterviewQuestionAnswerGroups([
    message("orphan", "user", "answer"),
    message("clarify", "assistant", "clarification"),
    message("answer", "user", "answer"),
    message("question", "assistant", "question"),
    message("finish", "assistant", "finish"),
  ]);

  assert.deepEqual(groups.map((group) => ({
    questionId: group.question.id,
    answerId: group.answer?.id ?? null,
  })), [
    { questionId: "clarify", answerId: "answer" },
    { questionId: "question", answerId: null },
  ]);
});

test("keeps group identity stable when an optimistic answer is replaced", () => {
  const before = buildInterviewQuestionAnswerGroups([
    message("question", "assistant", "question"),
    { ...message("local-answer", "user", "answer"), sequence: null, status: "sending" },
  ]);
  const after = buildInterviewQuestionAnswerGroups([
    message("question", "assistant", "question"),
    { ...message("durable-answer", "user", "answer"), sequence: 2, status: "sent" },
  ]);

  assert.equal(before[0].id, after[0].id);
});

test("marks every group with at least one visible message as visible", () => {
  const groups = buildInterviewQuestionAnswerGroups([
    message("question-1", "assistant", "question"),
    message("answer-1", "user", "answer"),
    message("question-2", "assistant", "question"),
    message("answer-2", "user", "answer"),
    message("question-3", "assistant", "question"),
  ]);

  assert.deepEqual(
    [...visibleGroupIds(groups, new Set(["answer-1", "question-2", "answer-2"]))],
    ["question-answer:question-1", "question-answer:question-2"],
  );
});
