import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRequestConflictError,
  agentErrorResponse,
  agentErrorHttpStatus,
} from "@/lib/interview/agent/protocols/errors";

test("maps Agent request conflicts to HTTP 409", () => {
  assert.equal(
    agentErrorHttpStatus(new AgentRequestConflictError("conflict")),
    409,
  );
  assert.equal(agentErrorHttpStatus(new Error("other")), null);
});

test("builds the conflict response consumed by the message route", () => {
  assert.deepEqual(
    agentErrorResponse(new AgentRequestConflictError("conflict")),
    {
      status: 409,
      body: {
        error: "Idempotency key conflicts with an existing answer",
      },
    },
  );
  assert.equal(agentErrorResponse(new Error("other")), null);
});
