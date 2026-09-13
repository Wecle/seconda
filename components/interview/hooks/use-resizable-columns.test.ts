import test from "node:test";
import assert from "node:assert/strict";
import { clampRatio } from "./use-resizable-columns";

test("clampRatio respects minLeft and minRight bounds", () => {
  const containerWidth = 1000;
  const minLeft = 420;
  const minRight = 380;

  assert.equal(clampRatio(0.5, containerWidth, minLeft, minRight), 0.5);
  assert.equal(clampRatio(0.2, containerWidth, minLeft, minRight), 0.42);
  assert.equal(clampRatio(0.9, containerWidth, minLeft, minRight), 0.62);
});

test("clampRatio falls back safely when container is narrower than total minWidth", () => {
  const containerWidth = 700;
  const minLeft = 420;
  const minRight = 380;

  const result = clampRatio(0.5, containerWidth, minLeft, minRight);
  assert.ok(result >= 0.3 && result <= 0.7);
});
