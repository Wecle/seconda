import assert from "node:assert/strict";
import test from "node:test";
import { APICallError } from "ai";
import { sanitizeAIError } from "./error-sanitizer";

test("sanitizes provider errors without retaining credentials, PII, bodies, or messages", () => {
  const error = new APICallError({
    message: "resume=Candidate Sentinel secret FAST_MODEL_API_KEY=sentinel-key",
    url: "https://api.deepseek.com/chat/completions",
    requestBodyValues: { resume: "Candidate Sentinel", authorization: "Bearer sentinel-key" },
    responseBody: "secret=sentinel-key",
    responseHeaders: { "x-request-id": "request-123", authorization: "Bearer sentinel-key" },
    statusCode: 429,
  });
  const serialized = JSON.stringify(sanitizeAIError(error));
  assert.equal(serialized.includes("Candidate Sentinel"), false);
  assert.equal(serialized.includes("sentinel-key"), false);
  assert.match(serialized, /api\.deepseek\.com/);
  assert.match(serialized, /request-123/);
});
