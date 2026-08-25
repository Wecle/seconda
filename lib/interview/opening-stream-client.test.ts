import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { parseInterviewOpeningSSEBlock, parseInterviewRoomEventData, parseInterviewRoomPayload } from "./client/opening-stream";

test("opening stream parser accepts strict room and completion events", () => {
  const interviewId = randomUUID();
  const runId = randomUUID();
  const roomEvent = {
    type: "room",
    view: {
      room: {
        interviewId,
        phase: "generating_question",
        currentQuestion: null,
        currentRound: 1,
        totalRounds: 5,
        canSubmitAnswer: false,
        canSkip: false,
        canEnd: false,
        retryableRunId: null,
      },
      transcript: [
        {
          type: "reasoning",
          runId,
          step: 1,
          attempt: 1,
          blockIndex: 0,
          sequence: 3,
          endSequence: 4,
          content: "Inspect the resume.",
          complete: false,
        },
        {
          type: "skill",
          runId,
          sequence: 5,
          name: "resume-deep-dive",
          status: "loaded",
          version: "1.0.0",
          code: null,
        },
      ],
    },
  };

  assert.deepEqual(
    parseInterviewOpeningSSEBlock(`data: ${JSON.stringify(roomEvent)}\n\n`),
    roomEvent,
  );
  assert.deepEqual(parseInterviewRoomPayload(roomEvent.view), roomEvent.view);
  assert.deepEqual(parseInterviewRoomEventData(JSON.stringify(roomEvent)), roomEvent.view);
  assert.deepEqual(parseInterviewOpeningSSEBlock("data: {\"type\":\"complete\",\"ok\":true}"), {
    type: "complete",
    ok: true,
  });
});

test("opening stream parser rejects malformed or unsafe envelopes", () => {
  assert.equal(parseInterviewOpeningSSEBlock("event: ping"), null);
  assert.equal(parseInterviewOpeningSSEBlock("data: {\"type\":\"complete\",\"ok\":\"yes\"}"), null);
  assert.equal(parseInterviewOpeningSSEBlock("data: {\"type\":\"room\",\"view\":{},\"extra\":true}"), null);
  assert.equal(parseInterviewOpeningSSEBlock("data: not-json"), null);
  assert.equal(parseInterviewRoomPayload({ room: {}, transcript: [], unsafe: true }), null);
  assert.equal(parseInterviewRoomEventData("not-json"), null);
  assert.equal(parseInterviewRoomEventData(JSON.stringify({ type: "tool_result", view: {} })), null);
});
