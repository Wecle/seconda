import assert from "node:assert/strict";
import test from "node:test";
import {
  InterviewCreationClientError,
  requestInterviewCreation,
  resetInterviewCreationAttempt,
  resolveInterviewCreationAttempt,
  validateInterviewTargetRole,
} from "./client/create-interview";

const request = {
  resumeVersionId: "11111111-1111-4111-8111-111111111111",
  language: "zh" as const,
  persona: "standard" as const,
  interviewType: "mixed" as const,
  targetLevel: "Mid" as const,
  targetRole: "前端工程师",
  preference: "重点考察系统设计",
  preferenceTags: ["系统设计"],
  targetRoundCount: 8,
};

test("browser client sends the idempotency key and normalized creation request", async () => {
  let receivedInput: RequestInfo | URL | undefined;
  let receivedInit: RequestInit | undefined;
  const result = await requestInterviewCreation({
    idempotencyKey: "create-key",
    request,
    fetcher: async (input, init) => {
      receivedInput = input;
      receivedInit = init;
      return Response.json({
        interviewId: "interview-1",
        status: "initializing",
        replayed: false,
      }, { status: 201 });
    },
  });

  assert.equal(receivedInput, "/api/interviews");
  assert.equal(receivedInit?.method, "POST");
  assert.deepEqual(receivedInit?.headers, {
    "Content-Type": "application/json",
    "Idempotency-Key": "create-key",
  });
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), request);
  assert.deepEqual(result, {
    interviewId: "interview-1",
    status: "initializing",
    replayed: false,
  });
});

test("browser client preserves a domain conflict code", async () => {
  await assert.rejects(
    requestInterviewCreation({
      idempotencyKey: "conflicting-key",
      request,
      fetcher: async () => Response.json(
        { error: "INTERVIEW_IDEMPOTENCY_CONFLICT" },
        { status: 409 },
      ),
    }),
    (error: unknown) => error instanceof InterviewCreationClientError
      && error.code === "INTERVIEW_IDEMPOTENCY_CONFLICT"
      && error.status === 409,
  );
});

test("browser client rejects malformed success responses", async () => {
  await assert.rejects(
    requestInterviewCreation({
      idempotencyKey: "malformed-key",
      request,
      fetcher: async () => Response.json({ status: "initializing" }, { status: 201 }),
    }),
    (error: unknown) => error instanceof InterviewCreationClientError
      && error.code === "INVALID_INTERVIEW_RESPONSE",
  );
  await assert.rejects(
    requestInterviewCreation({
      idempotencyKey: "malformed-status-key",
      request,
      fetcher: async () => Response.json({
        interviewId: "interview-1",
        status: "queued",
        replayed: false,
      }, { status: 201 }),
    }),
    (error: unknown) => error instanceof InterviewCreationClientError
      && error.code === "INVALID_INTERVIEW_RESPONSE",
  );
});

test("creation attempts reuse, rotate, and reset idempotency keys", () => {
  let keySequence = 0;
  const createKey = () => `key-${++keySequence}`;
  const first = resolveInterviewCreationAttempt({
    previous: null,
    request,
    createKey,
  });
  const unchangedRetry = resolveInterviewCreationAttempt({
    previous: first,
    request: { ...request },
    createKey,
  });
  const changedPayload = resolveInterviewCreationAttempt({
    previous: unchangedRetry,
    request: { ...request, targetRole: "后端工程师" },
    createKey,
  });
  const afterClose = resolveInterviewCreationAttempt({
    previous: resetInterviewCreationAttempt(),
    request,
    createKey,
  });

  assert.equal(first.idempotencyKey, "key-1");
  assert.equal(unchangedRetry, first);
  assert.equal(changedPayload.idempotencyKey, "key-2");
  assert.equal(afterClose.idempotencyKey, "key-3");
});

test("target role validation matches the server length boundary", () => {
  assert.equal(validateInterviewTargetRole("   "), "required");
  assert.equal(validateInterviewTargetRole("a".repeat(100)), null);
  assert.equal(validateInterviewTargetRole(` ${"a".repeat(100)} `), null);
  assert.equal(validateInterviewTargetRole("a".repeat(101)), "too_long");
});
