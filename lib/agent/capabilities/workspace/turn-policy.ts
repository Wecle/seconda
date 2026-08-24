type StepContentPart = { type: string };

export function decideWorkspaceStep(content: readonly StepContentPart[]) {
  return content.some((part) => part.type === "tool-result" || part.type === "tool-error")
    ? { action: "continue" as const }
    : { action: "stop" as const, reason: "workspace-response-complete" };
}
