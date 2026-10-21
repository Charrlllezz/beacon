// How old a crew member's map position is, for the label under their pin.
// Radios send a new position after moving ~100 m or every 15+ minutes, so a
// pin can be much older than the "last heard" time (any packet bumps that).

// Past this a pin is faded: the person has probably moved since.
export const PIN_STALE_SECS = 15 * 60;

export interface PinAge {
  label: string;  // "now", "4m", "2h"
  stale: boolean;
}

export function pinAge(locationAtSecs: number | undefined, nowSecs = Date.now() / 1000): PinAge {
  // A pin with no timestamp (stored before this existed) is treated as old,
  // never as live.
  if (!locationAtSecs) return { label: '?', stale: true };
  const age = Math.max(0, nowSecs - locationAtSecs);
  const stale = age >= PIN_STALE_SECS;
  if (age < 60) return { label: 'now', stale };
  if (age < 3600) return { label: `${Math.floor(age / 60)}m`, stale };
  if (age < 86400) return { label: `${Math.floor(age / 3600)}h`, stale };
  return { label: `${Math.floor(age / 86400)}d`, stale };
}

// When a position packet says it was taken. Radios stamp positions with GPS
// time; fall back to when the packet arrived, then to now. Never in the future
// (a radio with a bad clock shouldn't make a pin look fresher than "now").
export function positionTimestamp(posTime: number | undefined, rxTime: number | undefined, nowSecs = Math.floor(Date.now() / 1000)): number {
  const t = posTime || rxTime || nowSecs;
  return Math.min(t, nowSecs);
}
