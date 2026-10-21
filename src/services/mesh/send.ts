import { bleService } from '../ble/BleManager';
import { parseMessage } from './MessageService';
import { useMessagesStore } from '../../store/useMessagesStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import type { Message } from '../../types/messages';

export type SendResult =
  | { ok: true; message: Message }
  | { ok: false; reason: 'not-ready' | 'failed'; message: Message | null };

/**
 * Send a crew message from anywhere (chat, a card's reply buttons, the SOS
 * banner): shows it right away as 'sending', then 'sent' with its packet id,
 * or 'failed'. Callers decide what to tell the user.
 */
export async function sendCrewMessage(
  text: string,
  opts: { replyTo?: number; channelIndex?: number } = {},
): Promise<SendResult> {
  const myNodeNum = useDeviceStore.getState().myNodeNum;
  if (!myNodeNum) return { ok: false, reason: 'not-ready', message: null };
  const channelIndex = opts.channelIndex ?? 0;
  const myName = useCrewStore.getState().crewMembers[myNodeNum]?.longName ?? 'You';
  const now = Date.now();
  const selfId = `self-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const message: Message = {
    ...parseMessage(text, myNodeNum, myName, now, channelIndex),
    id: selfId,
    sendStatus: 'sending',
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  };
  const store = useMessagesStore.getState();
  store.addMessage(message);
  try {
    const packetId = await bleService.sendText(text, channelIndex, { replyId: opts.replyTo });
    useMessagesStore.getState().markSent(selfId, packetId);
    return { ok: true, message: { ...message, sendStatus: 'sent', packetId } };
  } catch (e) {
    console.warn('send failed:', e);
    useMessagesStore.getState().setSendStatus(selfId, 'failed');
    return { ok: false, reason: 'failed', message };
  }
}
