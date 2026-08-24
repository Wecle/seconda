import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isContextOverflowError, shouldContinueAfterStep } from "./runtime-policy";

describe("runtime step policy", () => {
  test("continues after successful and failed tool execution", () => {
    assert.equal(shouldContinueAfterStep([{ type: "tool-result" }]), true);
    assert.equal(shouldContinueAfterStep([{ type: "tool-error" }]), true);
    assert.equal(shouldContinueAfterStep([{ type: "text" }]), false);
  });

  test("recognizes provider context overflow errors without classifying ordinary failures", () => {
    assert.equal(isContextOverflowError(new Error("maximum context length exceeded")), true);
    assert.equal(isContextOverflowError({ message: "prompt is too long" }), true);
    assert.equal(isContextOverflowError(new Error("upstream timeout")), false);
  });
});
