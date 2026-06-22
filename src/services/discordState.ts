let sniperRunning = true;
let lastHandshakeAt: Date | null = null;

export function isSniperRunning(): boolean {
  return sniperRunning;
}

export function setSniperRunning(running: boolean): void {
  sniperRunning = running;
}

export function getLastHandshakeAt(): Date | null {
  return lastHandshakeAt;
}

export function updateLastHandshakeAt(): void {
  lastHandshakeAt = new Date();
}
