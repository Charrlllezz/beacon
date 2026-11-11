// Math for the arrow finder: which way to point, and how to turn the arrow
// without it spinning the long way round.

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Phone and radio GPS are good to roughly 5–15 m each, so inside this the
// arrow is guessing. Say "look around" instead of pointing.
export const CLOSE_RANGE_M = 20;

/** 0–360, wraps any angle. */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Initial compass bearing from one point to another: 0 = north, 90 = east. */
export function bearingDegrees(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

/** Where the arrow points on screen (0 = straight ahead), given where the phone faces. */
export function arrowAngle(bearing: number, heading: number): number {
  return normalizeDegrees(bearing - heading);
}

/**
 * The arrow's rotation is a running total, not 0–360: going from 350° to 10°
 * should turn 20° clockwise, not 340° back. Returns the next running total.
 */
export function nextRotation(current: number, target: number): number {
  const delta = normalizeDegrees(target - current + 180) - 180;
  return current + delta;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** "NE" etc., for when the compass isn't available. */
export function compassPoint(bearing: number): string {
  return POINTS[Math.round(normalizeDegrees(bearing) / 45) % 8];
}

/**
 * The heading to steer by. iOS reports trueHeading -1 until it has a location
 * fix; magnetic north is a few degrees off in California, which is fine for
 * an arrow. Null means no compass at all.
 */
export function usableHeading(h: { trueHeading: number; magHeading: number }): number | null {
  if (h.trueHeading >= 0) return h.trueHeading;
  if (h.magHeading >= 0) return h.magHeading;
  return null;
}
