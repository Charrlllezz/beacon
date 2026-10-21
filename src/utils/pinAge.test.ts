import { describe, test, expect } from 'vitest';
import { pinAge, positionTimestamp, PIN_STALE_SECS } from './pinAge';

const NOW = 1_800_000_000;

describe('pinAge', () => {
  test('labels by minutes, hours and days', () => {
    expect(pinAge(NOW - 10, NOW)).toEqual({ label: 'now', stale: false });
    expect(pinAge(NOW - 3 * 60, NOW)).toEqual({ label: '3m', stale: false });
    expect(pinAge(NOW - 40 * 60, NOW)).toEqual({ label: '40m', stale: true });
    expect(pinAge(NOW - 2 * 3600, NOW)).toEqual({ label: '2h', stale: true });
    expect(pinAge(NOW - 3 * 86400, NOW)).toEqual({ label: '3d', stale: true });
  });

  test('goes stale at 15 minutes', () => {
    expect(pinAge(NOW - PIN_STALE_SECS + 1, NOW).stale).toBe(false);
    expect(pinAge(NOW - PIN_STALE_SECS, NOW).stale).toBe(true);
  });

  test('a pin with no timestamp is never shown as live', () => {
    expect(pinAge(undefined, NOW)).toEqual({ label: '?', stale: true });
  });

  test('a timestamp from the future reads as now', () => {
    expect(pinAge(NOW + 500, NOW)).toEqual({ label: 'now', stale: false });
  });
});

describe('positionTimestamp', () => {
  test('prefers the GPS time, then receive time, then now', () => {
    expect(positionTimestamp(NOW - 100, NOW - 50, NOW)).toBe(NOW - 100);
    expect(positionTimestamp(undefined, NOW - 50, NOW)).toBe(NOW - 50);
    expect(positionTimestamp(0, undefined, NOW)).toBe(NOW);
  });

  test('clamps a future clock to now', () => {
    expect(positionTimestamp(NOW + 3600, undefined, NOW)).toBe(NOW);
  });
});
