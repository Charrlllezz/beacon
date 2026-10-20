import { describe, test, expect } from 'vitest';
import { batteryLabel, USB_POWERED_LEVEL } from './battery';

describe('batteryLabel', () => {
  test('percent, unknown, and USB power (firmware reports 101)', () => {
    expect(batteryLabel(57)).toBe('57%');
    expect(batteryLabel(undefined)).toBe('--');
    expect(batteryLabel(USB_POWERED_LEVEL)).toBe('USB');
  });
});
