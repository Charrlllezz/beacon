import { describe, test, expect } from 'vitest';
import { noticeForMessage } from './NotificationPolicy';
import type { Message } from '../../types/messages';

const ME = 0x5e6f7a;
const base = { id: 'm1', fromNodeId: 0xa1b2c3, fromName: 'Maya', timestamp: 0, channelIndex: 0 };
const away = { appActive: false, myNodeNum: ME };

describe('noticeForMessage', () => {
  test('text: sender display name as title, message as body', () => {
    const n = noticeForMessage({ ...base, type: 'text', text: 'where are you?' }, away);
    expect(n).toEqual({ title: 'Maya', body: 'where are you?', timeSensitive: false });
  });

  test('SOS is time-sensitive and names the sender', () => {
    const n = noticeForMessage({ ...base, type: 'sos', lat: 34.07, lng: -117.27 }, away);
    expect(n?.timeSensitive).toBe(true);
    expect(n?.title).toBe('SOS from Maya');
  });

  test('rally uses the note when present, a map hint otherwise', () => {
    expect(noticeForMessage({ ...base, type: 'rally', lat: 1, lng: 2, note: 'by the big tent' }, away))
      .toMatchObject({ title: 'Maya set a rally point', body: 'by the big tent', timeSensitive: false });
    expect(noticeForMessage({ ...base, type: 'rally', lat: 1, lng: 2 }, away)?.body)
      .toBe('Open RNDVU to see it on the map.');
  });

  test('meetup renders a 12h time, place, and note', () => {
    const n = noticeForMessage(
      { ...base, type: 'meetup', hour: 23, minute: 45, location: 'Main gate', note: 'before the countdown' },
      away,
    );
    expect(n).toMatchObject({ title: 'Maya set a meetup', body: '11:45 PM at Main gate: before the countdown' });
    expect(noticeForMessage({ ...base, type: 'meetup', hour: 0, minute: 5, location: 'Gate' }, away)?.body)
      .toBe('12:05 AM at Gate');
  });

  test('a reply notifies only the person whose message it answers', () => {
    const mine: Message = { ...base, id: 'mine', fromNodeId: ME, fromName: 'Me', type: 'meetup', hour: 23, minute: 0, location: 'Gate', packetId: 42 };
    const theirs: Message = { ...mine, fromNodeId: 0x999 };
    const omw: Message = { ...base, type: 'reply', kind: 'omw', replyTo: 42 };
    expect(noticeForMessage(omw, { ...away, replyTarget: mine }))
      .toEqual({ title: 'Maya is on the way', body: 'Answered your meetup.', timeSensitive: false });
    expect(noticeForMessage(omw, { ...away, replyTarget: theirs })).toBeNull();
    expect(noticeForMessage(omw, away)).toBeNull(); // original not on this phone
  });

  test("I'm coming (an SOS answer) is time-sensitive", () => {
    const sos: Message = { ...base, id: 'sos', fromNodeId: ME, type: 'sos', lat: 1, lng: 2, packetId: 7 };
    const coming: Message = { ...base, type: 'reply', kind: 'coming', replyTo: 7 };
    expect(noticeForMessage(coming, { ...away, replyTarget: sos }))
      .toEqual({ title: 'Maya is coming', body: 'Maya saw your SOS and is on the way.', timeSensitive: true });
  });

  test('SOS repeats nudge (same notification) until silenced', () => {
    const sos: Message = { ...base, type: 'sos', lat: 1, lng: 2, replyTo: 500 };
    expect(noticeForMessage(sos, { ...away, sos: { key: 'k', isHead: false, silenced: false } }))
      .toEqual({ title: 'SOS from Maya', body: 'Maya still needs help. Location updated.', timeSensitive: true, replaceKey: 'sos-k' });
    expect(noticeForMessage(sos, { ...away, sos: { key: 'k', isHead: false, silenced: true } })).toBeNull();
    // A repeat is the first this phone heard: full alert.
    expect(noticeForMessage(sos, { ...away, sos: { key: 'k', isHead: true, silenced: false } })?.body)
      .toBe('Maya needs help. Open RNDVU to see where they are.');
  });

  test("I'm OK from the SOS sender tells everyone and replaces the alert", () => {
    const theirSos: Message = { ...base, id: 's', type: 'sos', lat: 1, lng: 2, packetId: 500 };
    const safe: Message = { ...base, type: 'reply', kind: 'safe', replyTo: 500 };
    expect(noticeForMessage(safe, { ...away, replyTarget: theirSos, sos: { key: 'k', isHead: false, silenced: false } }))
      .toEqual({ title: 'Maya is OK', body: 'Maya cancelled their SOS.', timeSensitive: false, replaceKey: 'sos-k' });
    // Someone else can't cancel Maya's SOS.
    expect(noticeForMessage({ ...safe, fromNodeId: 0x777 }, { ...away, replyTarget: theirSos })).toBeNull();
  });

  test('silent while the app is in the foreground', () => {
    expect(noticeForMessage({ ...base, type: 'sos', lat: 1, lng: 2 }, { appActive: true, myNodeNum: ME })).toBeNull();
  });

  test('never notifies for our own messages', () => {
    expect(noticeForMessage({ ...base, fromNodeId: ME, type: 'text', text: 'hi' }, away)).toBeNull();
  });

  test('ambient types do not notify', () => {
    const ambient: Message[] = [
      { ...base, type: 'heading', stageId: 's' },
      { ...base, type: 'going', stageId: 's', artistId: 'a' },
      { ...base, type: 'tag', lat: 1, lng: 2, name: 'Water', category: 'water' },
      { ...base, type: 'color', color: '#fff' },
    ];
    for (const m of ambient) expect(noticeForMessage(m, away)).toBeNull();
  });
});
