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
// sort and the crew strip. (The dot used to allow an hour while the strip said
// 30 minutes, so they contradicted each other.)
//
// What a radio actually sends on firmware 2.7.26 with RNDVU's setup: battery
// every 30 min (the most frequent), position every 60 min when standing still
// (after ~100 m when moving), NodeInfo every 3 h. So 30 minutes of silence is
// normal, and one lost battery packet makes a 60-minute gap. 65 minutes rides
// out one lost packet without calling a quiet friend gone. Tighten this only
// if the radios are set to report more often.
export const IN_RANGE_SECS = 65 * 60;

export function isOnline(lastHeardSeconds?: number, thresholdSeconds = IN_RANGE_SECS): boolean {
  // touchLastHeard fires on every received packet (incl. duplicates), so
  // chatty peers stay online indefinitely.
  if (!lastHeardSeconds) return false;
  return Date.now() / 1000 - lastHeardSeconds < thresholdSeconds;
}
