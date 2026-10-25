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

// 24h hour/minute (as carried by MF:M meetups) → "9:05 PM".
export function formatClock(hour: number, minute: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

// One "in range" cutoff for the whole app: the card dot, the header count, the
// sort and the crew strip. A radio that's still around sends a position every
// ~15 minutes and a battery report every 30, so 30 minutes of silence means
// out of range, off or flat. (The dot used to allow an hour while the strip
// said 30 minutes, so a dead radio stayed green next to "5 of 6 in range".)
export const IN_RANGE_SECS = 30 * 60;

export function isOnline(lastHeardSeconds?: number, thresholdSeconds = IN_RANGE_SECS): boolean {
  // touchLastHeard fires on every received packet (incl. duplicates), so
  // chatty peers stay online indefinitely.
  if (!lastHeardSeconds) return false;
  return Date.now() / 1000 - lastHeardSeconds < thresholdSeconds;
}
