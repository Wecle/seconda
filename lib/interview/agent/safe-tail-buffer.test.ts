import assert from "node:assert/strict";
import test from "node:test";

import { createSafeTailBuffer } from "./safe-tail-buffer";

test("releases only text older than the configured Unicode safe tail", () => {
  const buffer = createSafeTailBuffer(64);
  const first = `${"🙂".repeat(70)} SELECT ${"x".repeat(70)}`;

  const released = buffer.acceptValidated(first);

  assert.equal([...released].length, [...first].length - 64);
  assert.equal(buffer.finishValidated(first), first.slice(released.length));
});

test("requires cumulative text to grow monotonically", () => {
  const buffer = createSafeTailBuffer(64);
  buffer.acceptValidated("正在核对简历证据");

  assert.throws(
    () => buffer.acceptValidated("改写了内容"),
    /monotonically/i,
  );
  assert.throws(
    () => buffer.finishValidated("不一致"),
    /validated text/i,
  );
});
