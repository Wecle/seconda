export type AgentRoomRequestEpoch = {
  current: number;
};

export function beginAgentRoomRequest(epoch: AgentRoomRequestEpoch) {
  epoch.current += 1;
  return epoch.current;
}

export function isLatestAgentRoomRequest(
  epoch: AgentRoomRequestEpoch,
  request: number,
) {
  return epoch.current === request;
}

export async function applyAgentRoomRefresh<T>(
  load: () => Promise<T>,
  apply: (value: T) => void,
  shouldApply: () => boolean = () => true,
) {
  const value = await load();
  if (!shouldApply()) return null;
  apply(value);
  return value;
}
