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
  protocol?: SafeProtocolDiagnostic;
};

type SafeProtocolDiagnostic = {
  kind: "inactive_tool" | "malformed_stream";
  reason: SafeProtocolReason;
  eventType: SafeProtocolEventType;
  stage: SafeProtocolStage;
};

type SafeProtocolReason =
  | "text_after_final_tool_call"
  | "text_after_tool_input"
  | "tool_input_start_after_final"
  | "malformed_tool_input_start"
  | "inactive_tool_input_start"
  | "duplicate_tool_input_start"
  | "parallel_tool_input_start"
  | "tool_input_delta_after_final"
  | "malformed_tool_input_delta"
  | "mismatched_tool_input_delta"
  | "tool_input_delta_after_end"
  | "tool_input_end_after_final"
  | "mismatched_tool_input_end"
  | "duplicate_tool_input_end"
  | "multiple_final_tool_calls"
  | "malformed_final_tool_call"
  | "inactive_final_tool_call"
  | "mismatched_final_tool_call";

type SafeProtocolEventType =
  | "text-delta"
  | "tool-input-start"
  | "tool-input-delta"
  | "tool-input-end"
  | "tool-call";

type SafeProtocolStage =
  | "before_tool_input"
  | "tool_input_streaming"
  | "tool_input_ended"
  | "final_tool_call";

const safeProtocolKinds = new Set<SafeProtocolDiagnostic["kind"]>([
  "inactive_tool",
  "malformed_stream",
]);
const safeProtocolReasons = new Set<SafeProtocolReason>([
  "text_after_final_tool_call",
  "text_after_tool_input",
  "tool_input_start_after_final",
  "malformed_tool_input_start",
  "inactive_tool_input_start",
  "duplicate_tool_input_start",
  "parallel_tool_input_start",
  "tool_input_delta_after_final",
  "malformed_tool_input_delta",
  "mismatched_tool_input_delta",
  "tool_input_delta_after_end",
  "tool_input_end_after_final",
  "mismatched_tool_input_end",
  "duplicate_tool_input_end",
  "multiple_final_tool_calls",
  "malformed_final_tool_call",
  "inactive_final_tool_call",
  "mismatched_final_tool_call",
]);
const safeProtocolEventTypes = new Set<SafeProtocolEventType>([
  "text-delta",
  "tool-input-start",
  "tool-input-delta",
  "tool-input-end",
  "tool-call",
]);
const safeProtocolStages = new Set<SafeProtocolStage>([
  "before_tool_input",
  "tool_input_streaming",
  "tool_input_ended",
  "final_tool_call",
]);

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
  const protocol = readSafeProtocolDiagnostic(unwrapped)
    ?? readSafeProtocolDiagnostic(error);
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
    ...(protocol ? { protocol } : {}),
  };
}

function readSafeProtocolDiagnostic(error: unknown): SafeProtocolDiagnostic | null {
  let current = error;
  const seen = new Set<object>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: unknown; protocol?: unknown; cause?: unknown };
    const protocol = coded.protocol;
    if (
      coded.code === "MODEL_STREAM_PROTOCOL_ERROR"
      && protocol
      && typeof protocol === "object"
    ) {
      const value = protocol as Record<string, unknown>;
      if (
        safeProtocolKinds.has(value.kind as SafeProtocolDiagnostic["kind"])
        && safeProtocolReasons.has(value.reason as SafeProtocolReason)
        && safeProtocolEventTypes.has(value.eventType as SafeProtocolEventType)
        && safeProtocolStages.has(value.stage as SafeProtocolStage)
      ) {
        return {
          kind: value.kind as SafeProtocolDiagnostic["kind"],
          reason: value.reason as SafeProtocolReason,
          eventType: value.eventType as SafeProtocolEventType,
          stage: value.stage as SafeProtocolStage,
        };
      }
    }
    current = coded.cause;
  }
  return null;
}
