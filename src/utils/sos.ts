import type { Message, SOSMessage } from '../types/messages';
import { respondersTo, type Responder } from './replies';

/** One SOS from first send to "I'm OK", as this phone heard it. */
export interface SosThread {
  root: SOSMessage;     // the first message of it this phone has (see sosHeads)
  key: string;          // sender + first alert's packet id
  lat: number;          // latest location
  lng: number;
  updatedAt: number;    // ms, latest send
  sends: number;        // alerts of this SOS this phone has received
  ended: boolean;       // sender said they're OK
  endedAt?: number;
  coming: Responder[];  // "I'm coming"
}

/** The first alert's packet id: a repeat points at it, the first alert is it. */
export function sosAnchor(m: SOSMessage): number | undefined {
  return m.replyTo ?? m.packetId;
}

export function threadKey(m: SOSMessage): string {
  const anchor = sosAnchor(m);
  // Stored before packet ids existed: each one is its own thread.
  return anchor ? `${m.fromNodeId}:${anchor}` : `${m.fromNodeId}:local:${m.id}`;
}

/**
 * The message that leads each SOS thread: the first alert, or, if this phone
 * missed it, the earliest repeat it did get. Repeats would otherwise be
 * hidden and a missed SOS would stay missed.
 */
export function sosHeads(messages: Message[]): SOSMessage[] {
  const seen = new Set<string>();
  const heads: SOSMessage[] = [];
  for (const m of messages) {
    // A first alert that failed to send has no packet id, so it became its
    // own thread that nothing could end: a stuck "YOUR SOS IS ON" card per
    // retry. The controller retries it; only what went out counts.
    if (m.type !== 'sos' || m.sendStatus === 'failed') continue;
    const key = threadKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    heads.push(m);
  }
  return heads;
}

export function isSosHead(messages: Message[], m: SOSMessage): boolean {
  return sosHeads(messages).some(h => h.id === m.id);
}

/**
 * Fold an SOS's alerts and answers into one thread. Only the sender's own
 * repeats and "safe" count, so nobody else can move or cancel someone's SOS.
 */
export function sosThread(messages: Message[], root: SOSMessage): SosThread {
  const key = threadKey(root);
  const anchor = sosAnchor(root);
  let lat = root.lat;
  let lng = root.lng;
  let updatedAt = root.timestamp;
  let sends = 0;
  let endedAt: number | undefined;
  for (const m of messages) {
    if (m.fromNodeId !== root.fromNodeId || m.sendStatus === 'failed') continue;
    if (m.type === 'sos' && (m.id === root.id || (anchor !== undefined && sosAnchor(m) === anchor))) {
      sends++;
      if (m.timestamp >= updatedAt) { lat = m.lat; lng = m.lng; updatedAt = m.timestamp; }
    } else if (anchor !== undefined && m.type === 'reply' && m.kind === 'safe' && m.replyTo === anchor) {
      endedAt = Math.max(endedAt ?? 0, m.timestamp);
    }
  }
  const coming = respondersTo(messages, anchor).filter(r => r.kind === 'coming');
  return { root, key, lat, lng, updatedAt, sends, ended: endedAt !== undefined, endedAt, coming };
}

/**
 * What the notification for a just-arrived message needs to know: the
 * message a reply answers, and for SOS alerts / "safe", which thread it's in,
 * whether it's the first this phone heard, and whether I've already answered
 * "I'm coming" or hidden its banner. `messages` already includes `message`.
 */
export function notificationContext(
  messages: Message[],
  message: Message,
  myNodeNum: number | null,
  hidden: ReadonlySet<string>,
): { replyTarget?: Message; sos?: { key: string; isHead: boolean; silenced: boolean } } {
  if (message.type === 'sos') {
    const key = threadKey(message);
    const iAmComing = myNodeNum !== null && respondersTo(messages, sosAnchor(message))
      .some(r => r.nodeId === myNodeNum && r.kind === 'coming');
    return { sos: { key, isHead: isSosHead(messages, message), silenced: hidden.has(key) || iAmComing } };
  }
  if (!message.replyTo) return {};
  const replyTo = message.replyTo;
  const replyTarget = messages.find(m => m.packetId === replyTo)
    // The first alert of an SOS may be missing here; any repeat of it stands in.
    ?? messages.find(m => m.type === 'sos' && m.replyTo === replyTo && m.fromNodeId === message.fromNodeId);
  if (message.type === 'reply' && message.kind === 'safe' && replyTarget?.type === 'sos') {
    return { replyTarget, sos: { key: threadKey(replyTarget), isHead: false, silenced: false } };
  }
  return { replyTarget };
}

/** SOS threads from other people that haven't been cancelled, newest first. */
export function activeSosFromOthers(messages: Message[], myNodeNum: number | null): SosThread[] {
  return sosHeads(messages)
    .filter(h => h.fromNodeId !== myNodeNum)
    .map(h => sosThread(messages, h))
    .filter(t => !t.ended)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
