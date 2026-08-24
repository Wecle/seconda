import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent, AgentEventType } from "./types";
import { projectConversationEntries, shouldAttachLiveAssistant } from "./conversation-projection";

function event(
  sequence: number,
  type: AgentEventType,
  runId: string | null,
  role: "user" | "assistant",
  content: unknown,
): AgentEvent {
  return {
    id: sequence,
    sessionId: "session",
    runId,
    sequence,
    type,
    payload: { message: { role, content } },
    createdAt: new Date(sequence),
  };
}

test("groups assistant steps from one run into one visual response", () => {
  const entries = projectConversationEntries([
    event(1, "user_message", "run-1", "user", "Inspect the workspace"),
    event(4, "assistant_message", "run-1", "assistant", [
      { type: "reasoning", text: "I should inspect both files." },
      { type: "text", text: "I will inspect both files." },
    ]),
    event(8, "assistant_message", "run-1", "assistant", [
      { type: "reasoning", text: "Now summarize." },
      { type: "text", text: "Here is the summary." },
    ]),
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[1]?.key, "assistant-run:run-1");
  assert.deepEqual(entries[1]?.steps.map((step) => step.sequence), [4, 8]);
  assert.equal(entries[1]?.closingSequence, 8);
});

test("keeps assistant responses from different runs separate", () => {
  const entries = projectConversationEntries([
    event(1, "user_message", "run-1", "user", "First question"),
    event(2, "assistant_message", "run-1", "assistant", "First run"),
    event(3, "user_message", "run-2", "user", "Second question"),
    event(4, "assistant_message", "run-2", "assistant", "Second run"),
  ]);

  assert.deepEqual(
    entries.filter((entry) => entry.role === "assistant").map((entry) => entry.key),
    ["assistant-run:run-1", "assistant-run:run-2"],
  );
});

test("does not merge legacy assistant events without a run id", () => {
  const entries = projectConversationEntries([
    event(1, "assistant_message", null, "assistant", "First legacy message"),
    event(2, "assistant_message", null, "assistant", "Second legacy message"),
  ]);

  assert.deepEqual(entries.map((entry) => entry.key), ["assistant:1", "assistant:2"]);
});

test("derives closing assistant from the last text-bearing step", () => {
  const entries = projectConversationEntries([
    event(1, "user_message", "run-1", "user", "Question"),
    event(2, "assistant_message", "run-1", "assistant", [{ type: "text", text: "Answer" }]),
    event(3, "assistant_message", "run-1", "assistant", [{ type: "reasoning", text: "Trailing reasoning" }]),
  ]);

  assert.equal(entries[1]?.closingSequence, 2);
  assert.equal(entries[1]?.steps.length, 2);
});

test("keeps a run grouped and keyed when an older history page is prepended", () => {
  const recentPage = [
    event(4, "assistant_message", "run-1", "assistant", "Narration"),
    event(8, "assistant_message", "run-1", "assistant", "Closing"),
  ];
  const recentEntries = projectConversationEntries(recentPage);
  assert.equal(recentEntries.length, 1);
  assert.equal(recentEntries[0]?.key, "assistant-run:run-1");
  assert.deepEqual(recentEntries[0]?.steps.map((step) => step.sequence), [4, 8]);

  const withOlderPage = [
    event(1, "user_message", "run-1", "user", "Question"),
    ...recentPage,
  ];

  const entries = projectConversationEntries(withOlderPage);
  assert.equal(entries.length, 2);
  assert.equal(entries[1]?.key, recentEntries[0]?.key);
  assert.deepEqual(entries[1]?.steps.map((step) => step.sequence), [4, 8]);
});

test("uses the user-message turn boundary when forked history has no run ids", () => {
  const entries = projectConversationEntries([
    event(1, "user_message", null, "user", "Forked question"),
    event(4, "assistant_message", null, "assistant", "Narration"),
    event(8, "assistant_message", null, "assistant", "Closing"),
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[1]?.key, "assistant-turn:1:legacy");
  assert.deepEqual(entries[1]?.steps.map((step) => step.sequence), [4, 8]);
});

test("does not treat missing run ids as a wildcard inside a turn", () => {
  const entries = projectConversationEntries([
    event(1, "user_message", "run-1", "user", "Question"),
    event(2, "assistant_message", "run-1", "assistant", "Current run"),
    event(3, "assistant_message", null, "assistant", "Legacy fragment"),
  ]);

  assert.deepEqual(
    entries.filter((entry) => entry.role === "assistant").map((entry) => entry.steps[0]?.sequence),
    [2, 3],
  );
});

test("keeps keys unique if corrupt history alternates run ids inside one turn", () => {
  const entries = projectConversationEntries([
    event(1, "user_message", "run-1", "user", "Question"),
    event(2, "assistant_message", "run-1", "assistant", "First"),
    event(3, "assistant_message", "run-2", "assistant", "Foreign"),
    event(4, "assistant_message", "run-1", "assistant", "Returned"),
  ]).filter((entry) => entry.role === "assistant");

  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);
  assert.deepEqual(entries.map((entry) => entry.key), [
    "assistant-run:run-1",
    "assistant-run:run-2",
    "assistant-run:run-1:4",
  ]);
});

test("attaches live output only to the current run's final assistant entry", () => {
  const current = projectConversationEntries([
    event(1, "user_message", "run-1", "user", "Question"),
    event(2, "assistant_message", "run-1", "assistant", "Narration"),
  ]);
  const stale = projectConversationEntries([
    event(1, "assistant_message", "run-old", "assistant", "Old answer"),
  ]);

  assert.equal(shouldAttachLiveAssistant(current, true, "run-1"), true);
  assert.equal(shouldAttachLiveAssistant(current, true, "run-2"), false);
  assert.equal(shouldAttachLiveAssistant(current, false, "run-1"), false);
  assert.equal(shouldAttachLiveAssistant(stale, true, "run-1"), false);
});
