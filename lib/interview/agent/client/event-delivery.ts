export async function deliverAgentRunEvent<T>(
  onEvent: (event: T) => void | Promise<void>,
  event: T,
) {
  try {
    await onEvent(event);
    return "delivered" as const;
  } catch {
    return "failed" as const;
  }
}
