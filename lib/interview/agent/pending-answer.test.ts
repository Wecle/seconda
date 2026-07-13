import assert from "node:assert/strict";
import test from "node:test";
import { clearPendingAnswer, loadPendingAnswer, savePendingAnswer, type PendingAnswer } from "./pending-answer";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

test("keeps one stable pending answer key across retries and clears it after acceptance", () => {
  const storage = createStorage();
  const answer: PendingAnswer = {
    localId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    content: "我的回答",
  };
  savePendingAnswer(storage, "interview-a", answer);
  assert.deepEqual(loadPendingAnswer(storage, "interview-a"), answer);
  assert.deepEqual(loadPendingAnswer(storage, "interview-a"), answer);
  clearPendingAnswer(storage, "interview-a");
  assert.equal(loadPendingAnswer(storage, "interview-a"), null);
});

test("rejects malformed or unbounded pending answer data", () => {
  const storage = createStorage();
  storage.setItem("seconda:pending-answer:v1:interview-a", JSON.stringify({
    localId: "not-a-uuid",
    idempotencyKey: "also-not-a-uuid",
    content: "answer",
  }));
  assert.equal(loadPendingAnswer(storage, "interview-a"), null);
});
