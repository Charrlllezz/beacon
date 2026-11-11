import { describe, it, expect } from 'vitest';
import { arrowAngle, bearingDegrees, compassPoint, nextRotation, normalizeDegrees, usableHeading } from './bearing';

// NOS Events Center, roughly. A degree of latitude is ~111 km; small offsets
// are enough to check direction.
const LAT = 34.0947;
const LNG = -117.2786;

describe('bearingDegrees', () => {
  it('points the four compass directions', () => {
    expect(bearingDegrees(LAT, LNG, LAT + 0.001, LNG)).toBeCloseTo(0, 0);
    expect(bearingDegrees(LAT, LNG, LAT, LNG + 0.001)).toBeCloseTo(90, 0);
    expect(bearingDegrees(LAT, LNG, LAT - 0.001, LNG)).toBeCloseTo(180, 0);
    expect(bearingDegrees(LAT, LNG, LAT, LNG - 0.001)).toBeCloseTo(270, 0);
  });

  it('is always 0–360', () => {
    const b = bearingDegrees(LAT, LNG, LAT + 0.001, LNG - 0.0001);
    expect(b).toBeGreaterThan(270);
    expect(b).toBeLessThan(360);
  });
});

describe('arrowAngle', () => {
  it('points straight ahead when facing them', () => {
    expect(arrowAngle(90, 90)).toBe(0);
  });

  it('points right when they are to your right', () => {
    // Facing north, friend to the east.
    expect(arrowAngle(90, 0)).toBe(90);
  });

  it('wraps across north', () => {
    // Facing 350°, friend at 10°: 20° to the right.
    expect(arrowAngle(10, 350)).toBe(20);
    // Facing 10°, friend at 350°: 20° to the left.
    expect(arrowAngle(350, 10)).toBe(340);
  });
});

describe('nextRotation', () => {
  it('takes the short way across north', () => {
    expect(nextRotation(350, 10)).toBe(370);
    expect(nextRotation(10, 350)).toBe(-10);
  });

  it('keeps a running total over several turns', () => {
    let r = 0;
    for (const target of [90, 180, 270, 0, 90]) r = nextRotation(r, target);
    expect(r).toBe(450);
  });

  it('does nothing when already there', () => {
    expect(nextRotation(720, 0)).toBe(720);
  });
});

describe('helpers', () => {
  it('normalizes negatives and big angles', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(725)).toBe(5);
  });

  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(200)).toBe('S');
  });

  it('falls back from true to magnetic heading', () => {
    expect(usableHeading({ trueHeading: 12, magHeading: 25 })).toBe(12);
    expect(usableHeading({ trueHeading: -1, magHeading: 25 })).toBe(25);
    expect(usableHeading({ trueHeading: -1, magHeading: -1 })).toBeNull();
  });
});
