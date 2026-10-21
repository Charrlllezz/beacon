import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const sendText = vi.fn();
vi.mock('../ble/BleManager', () => ({ bleService: { sendText: (...a: unknown[]) => sendText(...a) } }));

import { sosDue, startSos, tickSos, endSos, useSosStore, SOS_REPEAT_MS, type ActiveSos } from './SosController';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { useMessagesStore } from '../../store/useMessagesStore';

const ME = 0x5e6f7a;
const T0 = 1_800_000_000_000;
const sent = (n: number) => sendText.mock.calls[n] as [string, number, { replyId?: number }];

describe('sosDue', () => {
  const base: ActiveSos = { startedAt: T0, rootPacketId: 42, lastSentAt: T0, sends: 1 };
  test('repeats every 2 minutes, never stops by itself', () => {
    expect(sosDue(base, T0 + SOS_REPEAT_MS - 1, true)).toBe('none');
    expect(sosDue(base, T0 + SOS_REPEAT_MS, true)).toBe('repeat');
    expect(sosDue(base, T0 + 10 * 3600 * 1000, true)).toBe('repeat');
  });
  test('first alert not out yet: send it', () => {
    expect(sosDue({ ...base, rootPacketId: null, lastSentAt: null }, T0, true)).toBe('root');
  });
  test('ending: send safe', () => {
    expect(sosDue({ ...base, ending: true }, T0, true)).toBe('safe');
  });
  test('nothing while the radio is unreachable', () => {
    expect(sosDue(base, T0 + SOS_REPEAT_MS, false)).toBe('none');
    expect(sosDue(null, T0, true)).toBe('none');
  });
});

describe('SOS lifecycle', () => {
  let nextId = 100;
  beforeEach(() => {
    sendText.mockReset();
    sendText.mockImplementation(async () => nextId++);
    useSosStore.setState({ active: null });
    useMessagesStore.setState({ messages: [], isLoaded: false });
    useDeviceStore.setState({ myNodeNum: ME, status: 'connected' });
    useCrewStore.setState({ myLocation: { lat: 34.07, lng: -117.27 } });
  });

  test('start, repeat pointing at the first alert, then I\'m OK', async () => {
    expect(await startSos()).toBe(true);
    const root = useSosStore.getState().active!.rootPacketId!;
    expect(sent(0)).toEqual(['MF:!:34.0700,-117.2700', 0, { replyId: undefined }]);

    useCrewStore.setState({ myLocation: { lat: 34.08, lng: -117.28 } });
    await tickSos(Date.now() + SOS_REPEAT_MS);
    expect(sent(1)).toEqual(['MF:!:34.0800,-117.2800', 0, { replyId: root }]);
    expect(useSosStore.getState().active!.sends).toBe(2);

    await endSos();
    expect(sent(2)).toEqual(['MF:Y:safe', 0, { replyId: root }]);
    expect(useSosStore.getState().active).toBeNull();
  });

  test("I'm OK while out of reach keeps trying until it gets through", async () => {
    await startSos();
    const root = useSosStore.getState().active!.rootPacketId!;
    useDeviceStore.setState({ status: 'reconnecting' });
    await endSos();
    expect(useSosStore.getState().active).toMatchObject({ ending: true });
    expect(sendText).toHaveBeenCalledTimes(1);

    useDeviceStore.setState({ status: 'connected' });
    await tickSos();
    expect(sent(1)).toEqual(['MF:Y:safe', 0, { replyId: root }]);
    expect(useSosStore.getState().active).toBeNull();
  });

  test('cancelled before the first alert left the phone: nothing to tell anyone', async () => {
    useDeviceStore.setState({ status: 'disconnected' });
    await startSos();
    await endSos();
    expect(sendText).not.toHaveBeenCalled();
    expect(useSosStore.getState().active).toBeNull();
  });

  test('no location, no SOS', async () => {
    useCrewStore.setState({ myLocation: null });
    expect(await startSos()).toBe(false);
    expect(useSosStore.getState().active).toBeNull();
  });
});
