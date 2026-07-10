import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
} from "ai";
import { z } from "zod";
import type { ModelErrorAction } from "./model-fallback";

const NETWORK_CODES = /^(UND_ERR_[A-Z_]+|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED)$/;

function isTransientStatus(statusCode: number | undefined) {
  return statusCode === 408 || statusCode === 429 || (statusCode !== undefined && statusCode >= 500 && statusCode <= 599);
}

function unwrapRetryError(error: unknown): unknown {
  const seen = new Set<unknown>();
  let current = error;

  while (RetryError.isInstance(current) && !seen.has(current)) {
    seen.add(current);
    current = current.lastError;
  }

  return current;
}

function isNetworkTypeError(error: unknown) {
  if (!(error instanceof TypeError)) return false;
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return false;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" && NETWORK_CODES.test(code);
}

export function classifyModelError(error: unknown): ModelErrorAction {
  const unwrapped = unwrapRetryError(error);

  if (NoObjectGeneratedError.isInstance(unwrapped)) {
    return unwrapped.finishReason === "content-filter" ? "fatal" : "repair";
  }

  if (NoOutputGeneratedError.isInstance(unwrapped) || unwrapped instanceof z.ZodError) {
    return "repair";
  }

  if (APICallError.isInstance(unwrapped)) {
    const retryable = (unwrapped as { isRetryable?: unknown }).isRetryable;
    return isTransientStatus(unwrapped.statusCode) ||
      (unwrapped.statusCode === undefined && retryable === true)
      ? "transient"
      : "fatal";
  }

  return isNetworkTypeError(unwrapped) ? "transient" : "fatal";
}
