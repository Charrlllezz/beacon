import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));

import { MockBleManager } from './MockBleManager';

describe('MockBleManager listeners', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // App registers the packet router plus SOS and Find wake-ups. With a single
  // slot the last one replaced the router, so demo mode showed no crew.
  it('delivers every packet to every listener, like RealBleManager', async () => {
    const mgr = new MockBleManager();
    const router = vi.fn();
    const sosWake = vi.fn();
    const findWake = vi.fn();
    mgr.onPacket(router);
    mgr.onPacket(sosWake);
    const unsubFind = mgr.onPacket(findWake);

    const connected = mgr.connect('mock-device-001');
    await vi.advanceTimersByTimeAsync(5_000);
    await connected;

    expect(router).toHaveBeenCalled();
    expect(sosWake).toHaveBeenCalledTimes(router.mock.calls.length);
    expect(findWake).toHaveBeenCalledTimes(router.mock.calls.length);

    unsubFind();
    const before = findWake.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(findWake.mock.calls.length).toBe(before);
    expect(router.mock.calls.length).toBeGreaterThan(before);
    mgr.disconnect();
  });

  it('tells every status listener', async () => {
    const mgr = new MockBleManager();
    const a = vi.fn();
    const b = vi.fn();
    mgr.onStatus(a);
    mgr.onStatus(b);
    const connected = mgr.connect('mock-device-001');
    await vi.advanceTimersByTimeAsync(5_000);
    await connected;
    expect(a).toHaveBeenCalledWith('connected');
    expect(b).toHaveBeenCalledWith('connected');
    mgr.disconnect();
  });
});
