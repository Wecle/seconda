import assert from "node:assert/strict";
import test from "node:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  visibleGroupIds,
  type InterviewQuestionAnswerGroup,
} from "./interview-round-groups";
import {
  InterviewRoundNavigation,
  RoundNavigationMark,
  calculateRailMarkUpdates,
  cancelScheduledFrame,
  magneticEnergy,
  navigationScrollBehavior,
  railFocusFeedback,
  roundPreviewCopy,
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
  assert.equal((html.match(/data-focus-feedback="inactive"/g) ?? []).length, 2);
  assert.equal((html.match(/relative flex h-6 w-12 items-center/g) ?? []).length, 2);
  assert.equal((html.match(/h-0\.5 w-3 rounded-full/g) ?? []).length, 2);
  assert.match(html, /group-focus-visible\/mark:bg-foreground/);
  assert.match(html, /motion-reduce:translate-x-0/);
  assert.match(html, /motion-reduce:scale-x-100/);
  assert.match(html, /motion-reduce:transition-none/);
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

test("bounds the desktop rail to the transcript viewport with independent overflow", () => {
  const twentyGroups = Array.from({ length: 20 }, (_, index) => ({
    ...groups[1],
    id: `question-answer:q${index + 1}`,
    question: {
      ...groups[1].question,
      id: `q${index + 1}`,
    },
  }));
  const html = renderToStaticMarkup(
    <InterviewRoundNavigation
      groups={twentyGroups}
      scrollRootRef={createRef<HTMLDivElement>()}
      getMessageElement={() => null}
    />,
  );

  assert.equal((html.match(/data-round-navigation-mark/g) ?? []).length, 20);
  assert.match(html, /absolute -left-16 top-1\/2/);
  assert.match(html, /max-h-\[calc\(100%-1rem\)\]/);
  assert.match(html, /-translate-y-1\/2/);
  assert.match(html, /overflow-y-auto/);
  assert.match(html, /hidden/);
  assert.match(html, /xl:flex/);
});

test("uses restrained smooth falloff inside a forty pixel radius", () => {
  assert.equal(magneticEnergy(40, 40), 0);
  assert.equal(magneticEnergy(60, 40), 0);
  assert.equal(magneticEnergy(0, 40), 1);
  assert.ok(magneticEnergy(10, 40) > magneticEnergy(20, 40));
  assert.ok(magneticEnergy(20, 40) > magneticEnergy(30, 40));
});

test("derives every simultaneously visible question group", () => {
  assert.deepEqual(
    [...visibleGroupIds(groups, new Set(["a1", "q2"]))],
    ["question-answer:q1", "question-answer:q2"],
  );
});

test("builds preview copy for answered and waiting groups", () => {
  assert.deepEqual(roundPreviewCopy(groups[0]), {
    question: "为什么选择这个方案？",
    answer: "因为它能保持一致性。",
  });
  assert.deepEqual(roundPreviewCopy(groups[1]), {
    question: "你会如何验证？",
    answer: "等待回答",
  });
});

test("chooses click scrolling behavior from reduced-motion preference", () => {
  assert.equal(navigationScrollBehavior(false), "smooth");
  assert.equal(navigationScrollBehavior(true), "auto");
});

test("focus applies full feedback and blur resets it", () => {
  assert.deepEqual(railFocusFeedback(true), {
    energy: 1,
    previewOpen: true,
    status: "active",
  });
  assert.deepEqual(railFocusFeedback(false), {
    energy: 0,
    previewOpen: false,
    status: "inactive",
  });
});

test("exposes visible and non-visible viewport state without aria-current", () => {
  const visibleHtml = renderToStaticMarkup(
    <RoundNavigationMark
      group={groups[0]}
      visible
      onNavigate={() => undefined}
    />,
  );
  const nonVisibleHtml = renderToStaticMarkup(
    <RoundNavigationMark
      group={groups[1]}
      visible={false}
      onNavigate={() => undefined}
    />,
  );

  assert.match(
    visibleHtml,
    /aria-label="当前视口内，查看并定位：为什么选择这个方案？"/,
  );
  assert.match(
    nonVisibleHtml,
    /aria-label="当前视口外，查看并定位：你会如何验证？"/,
  );
  assert.doesNotMatch(`${visibleHtml}${nonVisibleHtml}`, /aria-current/);
});

test("calculates every mark update from one pointer snapshot", () => {
  assert.deepEqual(
    calculateRailMarkUpdates([
      {
        top: 0,
        height: 20,
        left: 0,
        width: 40,
        focusActive: false,
      },
      {
        top: 80,
        height: 20,
        left: 10,
        width: 0,
        focusActive: true,
      },
    ], { x: 20, y: 10 }),
    [
      { energy: 1, pointerPercentage: 50 },
      { energy: 1, pointerPercentage: 50 },
    ],
  );
});

test("cancels only a scheduled animation frame and clears its id", () => {
  const cancelled: number[] = [];
  const cancel = (frameId: number) => cancelled.push(frameId);

  assert.equal(cancelScheduledFrame(23, cancel), null);
  assert.deepEqual(cancelled, [23]);
  assert.equal(cancelScheduledFrame(null, cancel), null);
  assert.deepEqual(cancelled, [23]);
});

test("uses message ids as observer targets and question ids as stable navigation targets", () => {
  const visible = new Set(["a1", "q2"]);
  assert.deepEqual(
    [...visibleGroupIds(groups, visible)],
    ["question-answer:q1", "question-answer:q2"],
  );
  assert.deepEqual(
    groups.map((group) => group.question.id),
    ["q1", "q2"],
  );
});
