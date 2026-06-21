export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function humanizedDelay(baseMs: number, variancePercent = 0.3): Promise<void> {
  const variance = baseMs * variancePercent;
  const min = Math.max(500, Math.floor(baseMs - variance));
  const max = Math.floor(baseMs + variance);
  return randomDelay(min, max);
}
