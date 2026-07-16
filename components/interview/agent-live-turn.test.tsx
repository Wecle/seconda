import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentLiveTurn } from "./agent-live-turn";
import type { LiveTurnState } from "@/lib/interview/agent/room-state";

const baseTurn: LiveTurnState = {
  runId: "r1",
  logicalMessageId: "m1",
  currentAttemptId: "a1",
  phase: "reasoning",
  reasoningEntries: [],
  thinking: { expanded: true, userToggled: false, failed: false },
  provisionalResponse: "",
  responseStarted: false,
  lastSequence: 0,
};

function liveTurn(overrides: Partial<LiveTurnState>): LiveTurnState {
  return { ...baseTurn, ...overrides };
}

test("renders expanded reasoning and provisional response", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      phase: "responding",
      reasoningEntries: [{ entryId: "e1", attemptId: "a1", kind: "reasoning", text: "先核对证据。", status: "completed", discarded: false }],
      provisionalResponse: "请说明自动降级条件？",
      responseStarted: true,
      thinking: { expanded: true, userToggled: true, failed: false },
    })}
    active
    onToggle={() => {}}
  />);
  assert.match(html, /先核对证据/);
  assert.match(html, /请说明自动降级条件/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /content-visibility:auto/);
});

test("labels the public narrative as analysis rather than hidden thinking", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      reasoningEntries: [{
        entryId: "analysis",
        attemptId: "a1",
        kind: "reasoning",
        text: "回答提供了项目背景，但缺少具体技术取舍。",
        status: "completed",
        discarded: false,
      }],
    })}
    active={false}
    onToggle={() => {}}
  />);
  assert.match(html, /查看分析过程/);
  assert.doesNotMatch(html, /查看思考过程/);
});

test("shows discarded revisions with reduced emphasis and sanitized tool labels", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      reasoningEntries: [
        { entryId: "old", attemptId: "a0", kind: "reasoning", text: "原追问方向", status: "completed", discarded: true },
        { entryId: "tool:c1", attemptId: "a1", kind: "tool", text: "已核对简历证据", status: "completed", discarded: false },
      ],
    })}
    active={false}
    onToggle={() => {}}
  />);
  assert.match(html, /已调整方案/);
  assert.match(html, /opacity-60/);
  assert.match(html, /已核对简历证据/);
});

test("keeps reasoning hidden when collapsed while retaining the streamed response", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      reasoningEntries: [{ entryId: "e1", attemptId: "a1", kind: "reasoning", text: "内部公开叙事", status: "completed", discarded: false }],
      provisionalResponse: "下一题？",
      responseStarted: true,
      thinking: { expanded: false, userToggled: false, failed: false },
    })}
    active={false}
    onToggle={() => {}}
  />);
  assert.doesNotMatch(html, /内部公开叙事/);
  assert.match(html, /下一题/);
  assert.match(html, /aria-expanded="false"/);
});

test("shows a neutral placeholder before the first reasoning delta arrives", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      reasoningEntries: [{ entryId: "e1", attemptId: "a1", kind: "reasoning", text: "", status: "streaming", discarded: false }],
    })}
    active
    onToggle={() => {}}
  />);
  assert.match(html, /面试官分析中/);
  assert.match(html, /正在分析回答内容与简历证据，规划下一步问题/);
});

test("uses analysis terminology for failed and empty public narratives", () => {
  const failedHtml = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      reasoningEntries: [],
      thinking: { expanded: true, userToggled: false, failed: true },
    })}
    active={false}
    onToggle={() => {}}
  />);
  assert.match(failedHtml, /本轮分析未能完成/);
  assert.match(failedHtml, /本轮没有可公开的分析记录/);

  const completedEntryHtml = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      reasoningEntries: [{
        entryId: "analysis",
        attemptId: "a1",
        kind: "reasoning",
        text: "",
        status: "completed",
        discarded: false,
      }],
    })}
    active={false}
    onToggle={() => {}}
  />);
  assert.match(completedEntryHtml, /此步骤没有可公开的补充分析/);
});

test("hides an empty completed thinking panel", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      phase: "committing",
      responseStarted: true,
      thinking: { expanded: false, userToggled: false, failed: false },
    })}
    active={false}
    onToggle={() => {}}
  />);
  assert.equal(html, "");
});

test("keeps committed artifacts visible when an empty thinking panel is hidden", () => {
  const html = renderToStaticMarkup(<AgentLiveTurn
    turn={liveTurn({
      phase: "committing",
      responseStarted: true,
      thinking: { expanded: false, userToggled: false, failed: false },
    })}
    artifacts={[{
      runId: "r1",
      artifactId: "artifact-1",
      type: "background_saved",
      title: "背景已保存",
      summary: "已保存当前背景。",
      details: [],
    }]}
    active={false}
    onToggle={() => {}}
  />);
  assert.doesNotMatch(html, /查看思考过程/);
  assert.match(html, /背景已保存/);
});
