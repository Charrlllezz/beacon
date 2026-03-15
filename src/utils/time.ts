export function timeAgo(timestampSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestampSeconds;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function isOnline(lastHeardSeconds?: number, thresholdSeconds = 300): boolean {
  if (!lastHeardSeconds) return false;
  return Date.now() / 1000 - lastHeardSeconds < thresholdSeconds;
}
