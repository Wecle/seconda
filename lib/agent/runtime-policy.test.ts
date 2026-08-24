import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideWorkspaceStep } from "./capabilities/workspace/turn-policy";
import { isContextOverflowError } from "./runtime-policy";

describe("runtime step policy", () => {
  test("continues after successful and failed tool execution", () => {
    assert.deepEqual(decideWorkspaceStep([{ type: "tool-result" }]), { action: "continue" });
    assert.deepEqual(decideWorkspaceStep([{ type: "tool-error" }]), { action: "continue" });
    assert.deepEqual(decideWorkspaceStep([{ type: "text" }]), {
      action: "stop",
      reason: "workspace-response-complete",
    });
  });

  test("recognizes provider context overflow errors without classifying ordinary failures", () => {
    assert.equal(isContextOverflowError(new Error("maximum context length exceeded")), true);
    assert.equal(isContextOverflowError({ message: "prompt is too long" }), true);
    assert.equal(isContextOverflowError(new Error("upstream timeout")), false);
  });
});
