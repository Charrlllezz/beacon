// What the arrow screen shows when Ultra Wideband (UWB) is ranging. UWB gives
// an exact distance and, when the phones can "see" each other, a direction
// relative to the phone itself (no compass). Crowds block it, so direction
// comes and goes; distance alone still says warmer or colder.

export interface UwbReading {
  distance?: number; // metres
  azimuth?: number;  // radians, relative to the phone
  at: number;        // ms
}

// A reading older than this is ignored and the screen falls back to GPS.
export const UWB_FRESH_MS = 3000;
// Movement smaller than this is noise, not warmer/colder.
const TREND_M = 0.5;

export type Trend = 'warmer' | 'colder' | 'steady';

export function isFresh(r: UwbReading | null, nowMs: number): r is UwbReading {
  return !!r && r.distance !== undefined && nowMs - r.at < UWB_FRESH_MS;
}

/** Arrow angle in degrees (0 = ahead, clockwise), or null without a direction. */
export function uwbArrowDegrees(r: UwbReading): number | null {
  if (r.azimuth === undefined) return null;
  return ((r.azimuth * 180) / Math.PI + 360) % 360;
}

/** Compare against a reading a couple of seconds back. */
export function trend(previous: number | undefined, current: number): Trend {
  if (previous === undefined) return 'steady';
  if (current < previous - TREND_M) return 'warmer';
  if (current > previous + TREND_M) return 'colder';
  return 'steady';
}

/** "3.4 m" up close, whole metres further out. */
export function formatPrecise(m: number): string {
  return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}
