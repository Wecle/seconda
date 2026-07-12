import assert from "node:assert/strict";
import test from "node:test";
import { isAbortError } from "./request-error";

test("recognizes an aborted browser request", () => {
  assert.equal(isAbortError(new DOMException("Aborted", "AbortError")), true);
});

test("does not classify ordinary failures or non-errors as aborts", () => {
  assert.equal(isAbortError(new Error("network failed")), false);
  assert.equal(isAbortError("AbortError"), false);
});
