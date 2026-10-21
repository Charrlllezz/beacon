import { describe, test, expect } from 'vitest';
import { sosThread, activeSosFromOthers, sosHeads, notificationContext } from './sos';
import type { Message, SOSMessage } from '../types/messages';

const ASH = 1, BO = 2, ME = 9;
const root: SOSMessage = {
  id: 'sos', fromNodeId: ASH, fromName: 'Ash', timestamp: 1000, channelIndex: 0,
  type: 'sos', lat: 34.0, lng: -117.0, packetId: 500,
};
let n = 0;
const msg = (m: Partial<Message> & Pick<Message, 'type'>): Message =>
  ({ id: `m${n++}`, fromNodeId: ASH, fromName: 'Ash', timestamp: 2000, channelIndex: 0, ...m } as Message);

describe('sosThread', () => {
  test('repeats move the location; only the sender can', () => {
    const t = sosThread([
      root,
      msg({ type: 'sos', lat: 34.1, lng: -117.1, replyTo: 500, timestamp: 3000 }),
      msg({ type: 'sos', lat: 34.05, lng: -117.05, replyTo: 500, timestamp: 2000 }), // late, older
      msg({ type: 'sos', lat: 99, lng: 99, replyTo: 500, fromNodeId: BO, timestamp: 4000 }), // not Ash
    ], root);
    expect([t.lat, t.lng, t.updatedAt, t.sends, t.ended]).toEqual([34.1, -117.1, 3000, 3, false]);
  });

  test("I'm coming answers are collected; safe from the sender ends it", () => {
    const t = sosThread([
      root,
      msg({ type: 'reply', kind: 'coming', replyTo: 500, fromNodeId: BO, fromName: 'Bo' }),
      msg({ type: 'reply', kind: 'safe', replyTo: 500, timestamp: 5000 }),
    ], root);
    expect(t.coming.map(r => r.name)).toEqual(['Bo']);
    expect(t.ended).toBe(true);
    expect(t.endedAt).toBe(5000);
  });

  test('someone else cannot cancel it', () => {
    const t = sosThread([root, msg({ type: 'reply', kind: 'safe', replyTo: 500, fromNodeId: BO })], root);
    expect(t.ended).toBe(false);
  });
});

describe('a phone that missed the first alert', () => {
  const r1 = { ...root, id: 'r1', packetId: 501, replyTo: 500, lat: 34.1, timestamp: 3000 } as SOSMessage;
  const r2 = { ...root, id: 'r2', packetId: 502, replyTo: 500, lat: 34.2, timestamp: 4000 } as SOSMessage;

  test('the first repeat it got leads the thread, later ones fold in', () => {
    expect(sosHeads([r1, r2]).map(h => h.id)).toEqual(['r1']);
    const t = sosThread([r1, r2], r1);
    expect([t.lat, t.sends]).toEqual([34.2, 2]);
    expect(activeSosFromOthers([r1, r2], ME).map(x => x.root.id)).toEqual(['r1']);
  });

  test('answers and safe still point at the first alert', () => {
    const coming = msg({ type: 'reply', kind: 'coming', replyTo: 500, fromNodeId: BO, fromName: 'Bo' });
    const safe = msg({ type: 'reply', kind: 'safe', replyTo: 500, timestamp: 5000 });
    const t = sosThread([r1, coming, safe], r1);
    expect(t.coming.map(r => r.name)).toEqual(['Bo']);
    expect(t.ended).toBe(true);
  });
});

describe('notificationContext', () => {
  const r1 = { ...root, id: 'r1', packetId: 501, replyTo: 500, timestamp: 3000 } as SOSMessage;

  test('first alert vs a repeat of one this phone has', () => {
    expect(notificationContext([root], root, ME, new Set()).sos).toEqual({ key: '1:500', isHead: true, silenced: false });
    expect(notificationContext([root, r1], r1, ME, new Set()).sos).toEqual({ key: '1:500', isHead: false, silenced: false });
  });

  test("silenced once I'm coming, or I hid the banner", () => {
    const coming = msg({ type: 'reply', kind: 'coming', replyTo: 500, fromNodeId: ME, fromName: 'Me' });
    expect(notificationContext([root, coming, r1], r1, ME, new Set()).sos?.silenced).toBe(true);
    expect(notificationContext([root, r1], r1, ME, new Set(['1:500'])).sos?.silenced).toBe(true);
  });

  test("safe finds the SOS (even only via a repeat) and shares its key", () => {
    const safe = msg({ type: 'reply', kind: 'safe', replyTo: 500 });
    const ctx = notificationContext([r1, safe], safe, ME, new Set());
    expect(ctx.replyTarget?.id).toBe('r1');
    expect(ctx.sos?.key).toBe('1:500');
  });
});

describe('activeSosFromOthers', () => {
  test('lists open SOS threads from others, not mine, not repeats, not ended', () => {
    const mine: SOSMessage = { ...root, id: 'mine', fromNodeId: ME, packetId: 600 };
    const bos: SOSMessage = { ...root, id: 'bo', fromNodeId: BO, fromName: 'Bo', packetId: 700, timestamp: 9000 };
    const all: Message[] = [
      root, mine, bos,
      msg({ type: 'sos', lat: 1, lng: 1, replyTo: 500, timestamp: 3000 }),
      msg({ type: 'reply', kind: 'safe', replyTo: 700, fromNodeId: BO }),
    ];
    const open = activeSosFromOthers(all, ME);
    expect(open.map(t => t.root.id)).toEqual(['sos']);
  });
});
