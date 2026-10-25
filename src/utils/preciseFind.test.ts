import { describe, test, expect } from 'vitest';
import { formatPrecise, isFresh, trend, uwbArrowDegrees, UWB_FRESH_MS } from './preciseFind';

describe('preciseFind', () => {
  test('a reading is used only while fresh and with a distance', () => {
    expect(isFresh({ distance: 4, at: 1000 }, 1000 + UWB_FRESH_MS - 1)).toBe(true);
    expect(isFresh({ distance: 4, at: 1000 }, 1000 + UWB_FRESH_MS)).toBe(false);
    expect(isFresh({ azimuth: 0.2, at: 1000 }, 1000)).toBe(false);
    expect(isFresh(null, 0)).toBe(false);
  });

  test('azimuth becomes a clockwise arrow angle', () => {
    expect(uwbArrowDegrees({ azimuth: 0, at: 0 })).toBe(0);
    expect(uwbArrowDegrees({ azimuth: Math.PI / 2, at: 0 })).toBeCloseTo(90);
    expect(uwbArrowDegrees({ azimuth: -Math.PI / 4, at: 0 })).toBeCloseTo(315);
    expect(uwbArrowDegrees({ distance: 3, at: 0 })).toBeNull();
  });

  test('warmer and colder ignore jitter', () => {
    expect(trend(undefined, 5)).toBe('steady');
    expect(trend(5, 4.8)).toBe('steady');
    expect(trend(5, 4)).toBe('warmer');
    expect(trend(4, 5)).toBe('colder');
  });

  test('distance shows decimals up close', () => {
    expect(formatPrecise(3.44)).toBe('3.4 m');
    expect(formatPrecise(27.6)).toBe('28 m');
  });
});
