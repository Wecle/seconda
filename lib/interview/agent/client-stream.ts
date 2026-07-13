export function nextReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
) {
  if (attempt >= 5) return null;
  const cap = Math.min(8_000, 500 * 2 ** attempt);
  return Math.floor(random() * cap);
}

export function latestRunSnapshotSequence(
  events: readonly { runId: string; sequence: number }[],
  runId: string | null | undefined,
) {
  if (!runId) return 0;
  let latest = 0;
  for (const event of events) {
    if (event.runId === runId && Number.isInteger(event.sequence) && event.sequence > latest) {
      latest = event.sequence;
    }
  }
  return latest;
}

export function agentRunEventsPath(interviewId: string, runId: string, afterSequence: number) {
  return `/api/interviews/${encodeURIComponent(interviewId)}/runs/${encodeURIComponent(runId)}/events?after=${afterSequence}`;
}
