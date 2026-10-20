import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FromRadio } from '../../types/mesh';
import { PortNum } from '../../types/mesh';
import { decodeTextMessage, RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK } from './MeshtasticCodec';

// RealBleManager against a fake ble-plx backed by MockFirmware (see
// testing/FakeBlePlx). Exercises the real connect / config drain / notify
// drain / reconnect code paths, including background behaviour.
vi.mock('react-native-ble-plx', () => import('./testing/FakeBlePlx'));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    multiRemove: async () => {},
  },
}));

import { resetWorld } from './testing/FakeBlePlx';
import { RealBleManager } from './RealBleManager';
import { useDeviceStore } from '../../store/useDeviceStore';

const PEER = 0xa1b2c3;

type World = ReturnType<typeof resetWorld>;

function sendPeerText(w: World, text: string) {
  w.firmware.injectMeshPacket({
    from: PEER,
    to: 0xffffffff,
    channel: 0,
    decoded: { portnum: PortNum.TEXT_MESSAGE_APP, payload: new TextEncoder().encode(text) },
    id: Math.floor(Math.random() * 0xfffffff) + 1,
    rxTime: Math.floor(Date.now() / 1000),
  });
}

function textsIn(packets: FromRadio[]): string[] {
  return packets
    .filter(p => p.packet?.decoded?.portnum === PortNum.TEXT_MESSAGE_APP)
    .map(p => decodeTextMessage(p.packet!.decoded!.payload));
}

describe('RealBleManager (fake ble-plx over MockFirmware)', () => {
  let w: World;
  let mgr: RealBleManager;
  let packets: FromRadio[];
  let statuses: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    w = resetWorld();
    mgr = new RealBleManager();
    packets = [];
    statuses = [];
    mgr.onPacket(p => packets.push(p));
    mgr.onStatus(s => statuses.push(s));
  });

  afterEach(() => {
    mgr.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function connectAndSettle(opts?: { autoRetry?: boolean }) {
    const p = mgr.connect(w.deviceId, opts);
    await vi.advanceTimersByTimeAsync(3000);
    await p;
  }

  test('registers a CoreBluetooth state-restoration identifier', () => {
    expect(w.restoreOptions?.restoreStateIdentifier).toBe('rndvu-ble-central');
    expect(typeof w.restoreOptions?.restoreStateFunction).toBe('function');
  });

  test('connects, drains config to configComplete, reports connected', async () => {
    await connectAndSettle();
    expect(statuses).toContain('connected');
    expect(packets.some(p => p.myInfo?.myNodeNum === w.firmware.myNodeNum)).toBe(true);
    expect(packets.some(p => p.configCompleteId === 42)).toBe(true);
    expect(w.connectCalls).toEqual([{ id: w.deviceId, timeout: 20000 }]);
  });

  test('backgrounded: an incoming message is delivered via notify alone, no poll needed', async () => {
    await connectAndSettle();
    mgr.setAppActive(false);
    sendPeerText(w, 'meet at the ferris wheel');
    // Well under the 5s backup poll: only the FROM_NUM notify can deliver it.
    await vi.advanceTimersByTimeAsync(200);
    expect(textsIn(packets)).toEqual(['meet at the ferris wheel']);
  });

  test('a notify that lands mid-drain is not lost (drain re-runs)', async () => {
    await connectAndSettle();
    let injected = false;
    w.afterRead = (wasEmpty) => {
      // The running drain just read "empty" but hasn't exited yet; a frame
      // arrives and its notify fires while that read is still in flight.
      // That notify is the only signal for the frame.
      if (wasEmpty && !injected) {
        injected = true;
        w.muteNotify = true;
        sendPeerText(w, 'squeezed in');
        w.muteNotify = false;
        w.notifyNow();
      }
    };
    sendPeerText(w, 'first');
    // Under the 5s poll, so only the drain-again path can pick up the second.
    await vi.advanceTimersByTimeAsync(500);
    expect(textsIn(packets)).toEqual(['first', 'squeezed in']);
  });

  test('link lost while backgrounded: parks a no-timeout connect, recovers when the radio returns', async () => {
    await connectAndSettle();
    mgr.setAppActive(false);
    w.connectCalls = [];
    statuses = [];

    w.goOutOfRange();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // an hour out of range
    expect(w.connectCalls).toEqual([{ id: w.deviceId, timeout: undefined }]);
    expect(statuses).toEqual(['reconnecting']);

    w.comeBackIntoRange();
    await vi.advanceTimersByTimeAsync(3000);
    expect(statuses.at(-1)).toBe('connected');

    sendPeerText(w, 'back on the mesh');
    await vi.advanceTimersByTimeAsync(200);
    expect(textsIn(packets)).toContain('back on the mesh');
  });

  test('foreground: backoff retries, then honest "disconnected" while still waiting for the radio', async () => {
    await connectAndSettle();
    w.connectCalls = [];
    statuses = [];

    w.goOutOfRange();
    // 10 timed attempts: backoff (≤15s each) + 20s connect timeout each.
    await vi.advanceTimersByTimeAsync(10 * 35_000);
    const timed = w.connectCalls.filter(c => c.timeout === 20000);
    expect(timed).toHaveLength(10);
    expect(w.connectCalls.at(-1)).toEqual({ id: w.deviceId, timeout: undefined });
    expect(statuses.at(-1)).toBe('disconnected');

    w.comeBackIntoRange();
    await vi.advanceTimersByTimeAsync(3000);
    expect(statuses.at(-1)).toBe('connected');
  });

  test('going to background swaps a queued backoff retry for a pending connect', async () => {
    await connectAndSettle();
    w.connectCalls = [];
    w.goOutOfRange();
    await vi.advanceTimersByTimeAsync(100); // retry timer queued, not fired
    expect(w.connectCalls).toEqual([]);

    mgr.setAppActive(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.connectCalls).toEqual([{ id: w.deviceId, timeout: undefined }]);
  });

  test('Release (disconnect) cancels a pending connect: the radio is not grabbed back', async () => {
    await connectAndSettle();
    mgr.setAppActive(false);
    w.goOutOfRange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.pending).toHaveLength(1);

    mgr.disconnect();
    expect(w.pending).toHaveLength(0);
    statuses = [];

    w.comeBackIntoRange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.linkUp).toBe(false);
    expect(statuses).not.toContain('connected');
  });

  test('Release also cancels a pending connect when no session ever came up (cold launch, radio away)', async () => {
    w.inRange = false;
    mgr.setAppActive(false);
    mgr.connect(w.deviceId, { autoRetry: true }).catch(() => {});
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.pending.some(p => p.id === w.deviceId)).toBe(true);

    mgr.disconnect();
    expect(w.pending).toHaveLength(0);
    w.comeBackIntoRange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.linkUp).toBe(false);
  });

  test('a cancelled connect does not clobber the connect that replaced it', async () => {
    await connectAndSettle();
    mgr.setAppActive(false);
    w.goOutOfRange();
    await vi.advanceTimersByTimeAsync(1000);

    // Reconnect tap: disconnect() cancels the pending connect, then a fresh one.
    mgr.disconnect();
    w.inRange = true;
    statuses = [];
    const p = mgr.connect(w.deviceId, { autoRetry: true });
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    expect(statuses.at(-1)).toBe('connected');
    expect(statuses).not.toContain('disconnected');
  });

  test('adopts a link iOS already holds (state restoration) instead of dialing again', async () => {
    w.linkUp = true; // native side restored the connection before JS started
    await connectAndSettle({ autoRetry: true });
    expect(w.connectCalls).toEqual([]);
    expect(statuses).toContain('connected');
    expect(packets.some(p => p.configCompleteId === 42)).toBe(true);
  });

  test('autoRetry: radio off at launch keeps trying instead of giving up', async () => {
    w.inRange = false;
    const p = mgr.connect(w.deviceId, { autoRetry: true }).catch(() => 'failed');
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await p).toBe('failed');
    expect(statuses.at(-1)).toBe('reconnecting');

    w.comeBackIntoRange();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(statuses.at(-1)).toBe('connected');
  });

  test('Re-provision on a radio from an older build turns location sharing back on', async () => {
    w.firmware.primaryChannel.positionPrecision = undefined; // no module_settings
    await connectAndSettle();
    useDeviceStore.getState().setMyNodeInfo({ myNodeNum: w.firmware.myNodeNum } as any);
    const p = mgr.setChannel(0, RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK, 1);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(w.firmware.primaryChannel.positionPrecision).toBe(32);
    expect(w.firmware.loraConfig.region).toBe(1);
  });

  test('without autoRetry (onboarding), a failed connect stays failed', async () => {
    w.inRange = false;
    const p = mgr.connect(w.deviceId).catch(() => 'failed');
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await p).toBe('failed');
    const calls = w.connectCalls.length;
    w.comeBackIntoRange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.connectCalls.length).toBe(calls);
    expect(statuses.at(-1)).toBe('disconnected');
  });
});
