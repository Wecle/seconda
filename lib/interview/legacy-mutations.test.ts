import assert from "node:assert/strict";
import test from "node:test";
import { POST as answer } from "../../app/api/interviews/[id]/answer/route";
import { POST as complete } from "../../app/api/interviews/[id]/complete/route";
import { POST as nextQuestion } from "../../app/api/interviews/[id]/next-question/route";

test("legacy interview mutation endpoints are unconditionally gone", async () => {
  for (const mutate of [answer, nextQuestion, complete]) {
    const response = await mutate();
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), {
      error: "Legacy interviews are read-only after the Agent migration",
    });
  }
});
