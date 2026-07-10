import assert from "node:assert/strict";
import test from "node:test";
import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
} from "ai";
import {
  GatewayAuthenticationError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayModelNotFoundError,
  GatewayRateLimitError,
  GatewayResponseError,
} from "@ai-sdk/gateway";
import { z } from "zod";
import { classifyModelError } from "./model-errors";

function apiError(statusCode?: number) {
  return new APICallError({
    message: "API call failed",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
  });
}

test("repairs a no-object error", () => {
  assert.equal(
    classifyModelError(
      new NoObjectGeneratedError({
        response: {} as never,
        usage: {} as never,
        finishReason: "stop",
      }),
    ),
    "repair",
  );
});

test("does not repair filtered structured output", () => {
  assert.equal(
    classifyModelError(
      new NoObjectGeneratedError({
        response: {} as never,
        usage: {} as never,
        finishReason: "content-filter",
      }),
    ),
    "fatal",
  );
});

test("repairs no-output errors", () => {
  assert.equal(classifyModelError(new NoOutputGeneratedError()), "repair");
});

test("repairs Zod validation errors", () => {
  const result = z.object({ required: z.string() }).safeParse({});
  assert.equal(result.success, false);
  if (!result.success) assert.equal(classifyModelError(result.error), "repair");
});

test("retries gateway rate limits and internal errors", () => {
  assert.equal(classifyModelError(new GatewayRateLimitError()), "transient");
  assert.equal(classifyModelError(new GatewayInternalServerError()), "transient");
});

test("retries only eligible Gateway response statuses", () => {
  assert.equal(
    classifyModelError(new GatewayResponseError({ statusCode: 408 })),
    "transient",
  );
  assert.equal(
    classifyModelError(new GatewayResponseError({ statusCode: 429 })),
    "transient",
  );
  assert.equal(
    classifyModelError(new GatewayResponseError({ statusCode: 503 })),
    "transient",
  );
  assert.equal(
    classifyModelError(new GatewayResponseError({ statusCode: 401 })),
    "fatal",
  );
});

test("falls back for unavailable Gateway models", () => {
  assert.equal(classifyModelError(new GatewayModelNotFoundError()), "fallback");
});

test("does not retry Gateway authentication or request failures", () => {
  assert.equal(classifyModelError(new GatewayAuthenticationError()), "fatal");
  assert.equal(classifyModelError(new GatewayInvalidRequestError()), "fatal");
});

test("retries only eligible API response statuses", () => {
  for (const statusCode of [408, 429, 500, 599]) {
    assert.equal(classifyModelError(apiError(statusCode)), "transient");
  }
  assert.equal(classifyModelError(apiError(409)), "fatal");
  assert.equal(classifyModelError(apiError(400)), "fatal");
});

test("unwraps the final RetryError cause", () => {
  const error = new RetryError({
    message: "retry exhausted",
    reason: "maxRetriesExceeded",
    errors: [apiError(429)],
  });
  assert.equal(classifyModelError(error), "transient");
});

test("retries documented network TypeErrors", () => {
  const error = new TypeError("network", {
    cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
  });
  assert.equal(classifyModelError(error), "transient");
});

test("treats programming and unknown errors as fatal", () => {
  assert.equal(classifyModelError(new TypeError("programming")), "fatal");
  assert.equal(classifyModelError(new Error("unknown")), "fatal");
});
