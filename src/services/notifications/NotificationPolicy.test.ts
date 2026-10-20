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
