export function timeAgo(timestampSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestampSeconds;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTime(isoString: string, timeZone?: string): string {
  const date = new Date(isoString);
  // Pass the festival timezone so set times render in venue-local time even
  // when the viewer's phone is on a different timezone.
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
}

export function isOnline(lastHeardSeconds?: number, thresholdSeconds = 3600): boolean {
  // 1-hour default — ~4x Meshtastic's position_broadcast_secs (900s) so we
  // tolerate 2-3 consecutive RF-dropped broadcasts before flipping a quiet
  // peer to offline. touchLastHeard fires on every received packet (incl.
  // duplicates), so chatty peers stay online indefinitely.
  if (!lastHeardSeconds) return false;
  return Date.now() / 1000 - lastHeardSeconds < thresholdSeconds;
}
