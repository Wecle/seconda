const activeRuns = new Map<string, AbortController>();

export function registerActiveRun(runId: string, controller: AbortController) {
  if (activeRuns.has(runId)) throw new Error(`Run ${runId} is already active`);
  activeRuns.set(runId, controller);
  return () => activeRuns.delete(runId);
}

export function cancelActiveRun(runId: string) {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort(new DOMException("Cancelled by user", "AbortError"));
  return true;
}
