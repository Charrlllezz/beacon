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
    expect(sendText).toHaveBeenCalledWith('MF:Y:omw', 0, { replyId: 0x4242 });

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

  test('before the radio reports its node number, nothing is sent', async () => {
    useDeviceStore.setState({ myNodeNum: null });
    expect(await sendCrewMessage('hello')).toEqual({ ok: false, reason: 'not-ready', message: null });
    expect(sendText).not.toHaveBeenCalled();
  });
});
