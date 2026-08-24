import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
} from "ai";
import { classifyModelError } from "./model-errors";

export type SafeAIErrorSummary = {
  category: "structured-output" | "content-filter" | "api" | "network" | "unknown";
  status: number | null;
  provider: string | null;
  model: string | null;
  retryable: boolean;
  requestId: string | null;
};

function unwrapRetryError(error: unknown): unknown {
  const seen = new Set<unknown>();
  let current = error;
  while (RetryError.isInstance(current) && !seen.has(current)) {
    seen.add(current);
    current = current.lastError;
  }
  return current;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function sanitizeAIError(error: unknown): SafeAIErrorSummary {
  const unwrapped = unwrapRetryError(error);
  const action = classifyModelError(error);
  const details = unwrapped && typeof unwrapped === "object"
    ? unwrapped as {
        statusCode?: unknown;
        url?: unknown;
        modelId?: unknown;
        responseHeaders?: unknown;
        isRetryable?: unknown;
      }
    : {};
  const status = typeof details.statusCode === "number" ? details.statusCode : null;
  const headers = details.responseHeaders && typeof details.responseHeaders === "object"
    ? details.responseHeaders as Record<string, unknown>
    : {};
  const url = readString(details.url);
  let provider: string | null = null;
  if (url) {
    try {
      provider = new URL(url).hostname;
    } catch {}
  }

  const category = NoObjectGeneratedError.isInstance(unwrapped) && unwrapped.finishReason === "content-filter"
    ? "content-filter"
    : NoObjectGeneratedError.isInstance(unwrapped) || NoOutputGeneratedError.isInstance(unwrapped)
      ? "structured-output"
      : APICallError.isInstance(unwrapped)
        ? "api"
        : unwrapped instanceof TypeError
          ? "network"
          : "unknown";

  return {
    category,
    status,
    provider,
    model: readString(details.modelId),
    retryable: action === "transient" || details.isRetryable === true,
    requestId: readString(headers["x-request-id"]) ?? readString(headers["request-id"]),
  };
}
