import assert from "node:assert/strict";
import test from "node:test";
import type { RoomMessage } from "@/lib/interview/agent/room-state";
import { buildInterviewRoomTimeline } from "./interview-room-timeline";

function message(id: string, role: "assistant" | "user", runId: string | null): RoomMessage {
  return { id, sequence: 1, role, runId, kind: role === "user" ? "answer" : "question", content: id };
}

test("groups an opening question and a candidate answer with its resulting question", () => {
  const timeline = buildInterviewRoomTimeline([
    message("q1", "assistant", "opening"),
    message("a1", "user", "answer-run"),
    message("q2", "assistant", "answer-run"),
  ]);

  assert.deepEqual(timeline.map((group) => ({
    runId: group.runId,
    beforeTurn: group.beforeTurn.map((item) => item.id),
    afterTurn: group.afterTurn.map((item) => item.id),
  })), [
    { runId: "opening", beforeTurn: [], afterTurn: ["q1"] },
    { runId: "answer-run", beforeTurn: ["a1"], afterTurn: ["q2"] },
  ]);
});

test("keeps a pending candidate message as a standalone group", () => {
  const pending = message("pending", "user", null);
  pending.sequence = null;
  pending.status = "sending";

  const timeline = buildInterviewRoomTimeline([pending]);

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].runId, null);
  assert.deepEqual(timeline[0].beforeTurn.map((item) => item.id), ["pending"]);
  assert.deepEqual(timeline[0].afterTurn, []);
});
