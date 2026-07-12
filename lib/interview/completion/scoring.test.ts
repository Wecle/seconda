import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "./scoring";

test("formal scoring never exceeds three concurrent calls", async () => {
  let active = 0;
  let maximum = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });
  assert.equal(maximum, 3);
});
