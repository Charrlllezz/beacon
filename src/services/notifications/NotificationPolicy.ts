import type { Message } from '../../types/messages';
import { formatClock } from '../../utils/time';

export interface LocalNotice {
  title: string;
  body: string;
  // SOS only. Maps to iOS interruptionLevel 'timeSensitive', which breaks
  // through Focus / notification summary so a locked phone actually lights up.
  timeSensitive: boolean;
}

/**
 * Decide whether an inbound mesh message deserves a local notification, and
 * what it says. Pure so it can be tested without expo-notifications.
 *
 * Only while the app isn't in the foreground: in the foreground the chat
 * already shows it. Own messages never notify (the radio can hand our own
 * packets back after a reconnect). going / ungoing / heading / tag / colour
 * are ambient state, not something worth waking a phone in a pocket for.
 */
export function noticeForMessage(
  message: Message,
  opts: { appActive: boolean; myNodeNum: number | null },
): LocalNotice | null {
  if (opts.appActive) return null;
  if (opts.myNodeNum !== null && message.fromNodeId === opts.myNodeNum) return null;

  const who = message.fromName;
  switch (message.type) {
    case 'text':
      return { title: who, body: message.text, timeSensitive: false };
    case 'rally':
      return {
        title: `${who} set a rally point`,
        body: message.note || 'Open RNDVU to see it on the map.',
        timeSensitive: false,
      };
    case 'meetup': {
      const when = `${formatClock(message.hour, message.minute)} at ${message.location}`;
      return {
        title: `${who} set a meetup`,
        body: message.note ? `${when}: ${message.note}` : when,
        timeSensitive: false,
      };
    }
    case 'sos':
      return {
        title: `SOS from ${who}`,
        body: `${who} needs help. Open RNDVU to see where they are.`,
        timeSensitive: true,
      };
    default:
      return null;
  }
}
