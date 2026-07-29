export class AgentRequestConflictError extends Error {
  readonly code = "AGENT_REQUEST_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "AgentRequestConflictError";
  }
}

export function agentErrorHttpStatus(error: unknown): 409 | null {
  return error instanceof AgentRequestConflictError ? 409 : null;
}

export function agentErrorResponse(error: unknown): {
  status: 409;
  body: {
    error: string;
  };
} | null {
  const status = agentErrorHttpStatus(error);
  if (!status) return null;
  return {
    status,
    body: {
      error: "Idempotency key conflicts with an existing answer",
    },
  };
}
