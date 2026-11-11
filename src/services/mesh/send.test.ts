import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const sendText = vi.fn();
vi.mock('../ble/BleManager', () => ({ bleService: { sendText: (...a: unknown[]) => sendText(...a) } }));

import { sendCrewMessage } from './send';
import { useMessagesStore } from '../../store/useMessagesStore';
import { useDeviceStore } from '../../store/useDeviceStore';

const ME = 0x5e6f7a;

describe('sendCrewMessage', () => {
  beforeEach(() => {
    sendText.mockReset();
    useMessagesStore.setState({ messages: [], isLoaded: false });
    useDeviceStore.setState({ myNodeNum: ME });
  });

  test('shows the message at once, then marks it sent with its packet id', async () => {
    let release!: (id: number) => void;
    sendText.mockReturnValue(new Promise<number>(r => { release = r; }));
    const pending = sendCrewMessage('MF:Y:omw', { replyTo: 0x4242 });

    const shown = useMessagesStore.getState().messages[0];
    expect(shown).toMatchObject({ type: 'reply', kind: 'omw', replyTo: 0x4242, sendStatus: 'sending', fromNodeId: ME });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledWith('MF:Y:omw', 0, { replyId: 0x4242 }));

    release(0xcafe);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(useMessagesStore.getState().messages[0]).toMatchObject({ sendStatus: 'sent', packetId: 0xcafe });
  });

  test('a failed write is marked failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    sendText.mockRejectedValue(new Error('Not connected'));
    const result = await sendCrewMessage('hello');
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    expect(useMessagesStore.getState().messages[0].sendStatus).toBe('failed');
  });

  test('a second message waits for the first instead of being dropped', async () => {
    const releases: ((id: number) => void)[] = [];
    sendText.mockImplementation(() => new Promise<number>(r => { releases.push(r); }));
    const first = sendCrewMessage('one');
    const second = sendCrewMessage('two');
    expect(useMessagesStore.getState().messages.map(m => m.sendStatus)).toEqual(['sending', 'sending']);

    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    releases[0](1);
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));
    expect(sendText.mock.calls.map(c => c[0])).toEqual(['one', 'two']);
    releases[1](2);
    expect((await first).ok && (await second).ok).toBe(true);
  });

  test('before the radio reports its node number, nothing is sent', async () => {
    useDeviceStore.setState({ myNodeNum: null });
    expect(await sendCrewMessage('hello')).toEqual({ ok: false, reason: 'not-ready', message: null });
    expect(sendText).not.toHaveBeenCalled();
  });
});
