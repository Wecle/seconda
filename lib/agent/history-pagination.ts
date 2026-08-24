export function isCurrentHistoryRequest(input: {
  requestVersion: number;
  currentVersion: number;
  requestSessionId: string;
  currentSessionId: string | null;
}) {
  return input.requestVersion === input.currentVersion
    && input.requestSessionId === input.currentSessionId;
}
