import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { isUsableQuestionPartial, validateGeneratedQuestion } from "./next-question-contract";

test("recognizes only new non-blank question, topic, or tip partials", () => {
  const previous = { question: "Question", topic: "Topic", tip: "Tip" };
  assert.equal(isUsableQuestionPartial(previous, { question: "   " }), false);
  assert.equal(isUsableQuestionPartial(previous, { question: "Question", topic: "Topic" }), false);
  assert.equal(isUsableQuestionPartial(previous, { topic: "New topic" }), true);
  assert.equal(isUsableQuestionPartial(previous, { tip: "New tip" }), true);
  assert.equal(isUsableQuestionPartial(previous, { question: "New question" }), true);
});

test("rejects an empty final question before it can be persisted", () => {
  assert.throws(() => validateGeneratedQuestion({ question: " \n " }), z.ZodError);
  assert.doesNotThrow(() => validateGeneratedQuestion({ question: "What did you build?" }));
});
