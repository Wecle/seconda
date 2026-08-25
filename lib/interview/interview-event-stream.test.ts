import assert from "node:assert/strict";
import test from "node:test";
import { createInterviewEventStream, resolveInterviewEventCursor } from "./application/interview-event-stream";

const decoder = new TextDecoder();

function decodeRoomChunk(chunk: Uint8Array) {
  const text = decoder.decode(chunk);
  const id = Number(text.match(/^id: (\d+)$/m)?.[1]);
  const data = text.match(/^data: (.+)$/m)?.[1];
  assert.ok(data);
  return { id, payload: JSON.parse(data) as { type: "room"; view: { transcript: string[] } } };
}

test("event cursor uses the greatest query/header cursor and rejects invalid or future cursors", () => {
  assert.deepEqual(resolveInterviewEventCursor({ after: "3", lastEventId: "5", current: 8 }), { ok: true, cursor: 5 });
  assert.deepEqual(resolveInterviewEventCursor({ after: "7", lastEventId: "5", current: 8 }), { ok: true, cursor: 7 });
  assert.deepEqual(resolveInterviewEventCursor({ after: "-1", lastEventId: null, current: 8 }), { ok: false, reason: "invalid" });
  assert.deepEqual(resolveInterviewEventCursor({ after: "9", lastEventId: "5", current: 8 }), { ok: false, reason: "ahead" });
});

test("reconnect resumes after Last-Event-ID and emits only a newer full room projection", async () => {
  const firstStream = createInterviewEventStream({
    cursor: 0,
    signal: new AbortController().signal,
    pollIntervalMs: 1,
    loadSnapshot: async () => ({ cursor: 5, view: { transcript: ["one"] } }),
  });
  const firstReader = firstStream.getReader();
  const first = await firstReader.read();
  assert.equal(first.done, false);
  const initialEvent = decodeRoomChunk(first.value!);
  assert.equal(initialEvent.id, 5);
  await firstReader.cancel();

  let calls = 0;
  const reconnectStream = createInterviewEventStream({
    cursor: 5,
    signal: new AbortController().signal,
    pollIntervalMs: 1,
    loadSnapshot: async () => {
      calls += 1;
      return calls < 3
        ? { cursor: 5, view: { transcript: ["one"] } }
        : { cursor: 8, view: { transcript: ["one", "two"] } };
    },
  });
  const reconnectReader = reconnectStream.getReader();
  const resumed = await reconnectReader.read();
  assert.equal(resumed.done, false);
  const resumedEvent = decodeRoomChunk(resumed.value!);
  assert.equal(resumedEvent.id, 8);

  let rendered = initialEvent.payload.view;
  rendered = resumedEvent.payload.view;
  assert.deepEqual(rendered.transcript, ["one", "two"]);
  assert.equal(rendered.transcript.filter((item) => item === "one").length, 1);
  await reconnectReader.cancel();
});
