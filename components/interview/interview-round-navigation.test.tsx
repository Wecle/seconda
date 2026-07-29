import assert from "node:assert/strict";
import test from "node:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InterviewQuestionAnswerGroup } from "./interview-round-groups";
import {
  InterviewRoundNavigation,
  magneticEnergy,
} from "./interview-round-navigation";

const groups: InterviewQuestionAnswerGroup[] = [
  {
    id: "question-answer:q1",
    question: {
      id: "q1",
      sequence: 1,
      role: "assistant",
      kind: "question",
      content: "为什么选择这个方案？",
    },
    answer: {
      id: "a1",
      sequence: 2,
      role: "user",
      kind: "answer",
      content: "因为它能保持一致性。",
    },
  },
  {
    id: "question-answer:q2",
    question: {
      id: "q2",
      sequence: 3,
      role: "assistant",
      kind: "question",
      content: "你会如何验证？",
    },
    answer: null,
  },
];

test("renders one equal-width resting mark per question group without round numbers", () => {
  const html = renderToStaticMarkup(
    <InterviewRoundNavigation
      groups={groups}
      scrollRootRef={createRef<HTMLDivElement>()}
      getMessageElement={() => null}
    />,
  );

  assert.equal((html.match(/data-round-navigation-mark/g) ?? []).length, 2);
  assert.match(html, /查看并定位：为什么选择这个方案/);
  assert.match(html, /查看并定位：你会如何验证/);
  assert.doesNotMatch(html, /第 1 轮|第 2 轮/);
  assert.equal((html.match(/data-resting-width="equal"/g) ?? []).length, 2);
});

test("does not render an empty rail", () => {
  const html = renderToStaticMarkup(
    <InterviewRoundNavigation
      groups={[]}
      scrollRootRef={createRef<HTMLDivElement>()}
      getMessageElement={() => null}
    />,
  );

  assert.equal(html, "");
});

test("uses restrained smooth falloff inside a forty pixel radius", () => {
  assert.equal(magneticEnergy(40, 40), 0);
  assert.equal(magneticEnergy(60, 40), 0);
  assert.equal(magneticEnergy(0, 40), 1);
  assert.ok(magneticEnergy(10, 40) > magneticEnergy(20, 40));
  assert.ok(magneticEnergy(20, 40) > magneticEnergy(30, 40));
});
