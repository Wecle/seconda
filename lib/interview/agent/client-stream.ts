export function nextReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
) {
  if (attempt >= 5) return null;
  const cap = Math.min(8_000, 500 * 2 ** attempt);
  return Math.floor(random() * cap);
}
