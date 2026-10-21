import { describe, test, expect } from 'vitest';
import { qrMatrix, rowRuns } from './qrMatrix';

describe('qrMatrix', () => {
  test('a crew invite fits a scannable square code', () => {
    const invite = `rndvu://join#v=1&cs=${'A'.repeat(70)}&n=${encodeURIComponent("Ash's crew")}`;
    const m = qrMatrix(invite);
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.length).toBeLessThanOrEqual(69); // version ≤ 13: fine on a phone screen
    expect(m.every(row => row.length === m.length)).toBe(true);
    // Finder pattern: the top-left 7x7 has a dark border.
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[6].slice(0, 7).every(Boolean)).toBe(true);
  });

  test('rows collapse into runs that add back up', () => {
    expect(rowRuns([true, true, false, true, false, false])).toEqual([[true, 2], [false, 1], [true, 1], [false, 2]]);
    const row = qrMatrix('hello')[3];
    expect(rowRuns(row).reduce((n, [, len]) => n + len, 0)).toBe(row.length);
  });
});
