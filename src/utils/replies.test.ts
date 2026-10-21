import { describe, test, expect } from 'vitest';
import { respondersTo, myAnswer, responderSummary } from './replies';
import type { Message, ReplyKind } from '../types/messages';

const MEETUP_PKT = 0x1111;
let seq = 0;
const reply = (from: number, name: string, kind: ReplyKind, at: number, replyTo = MEETUP_PKT): Message => ({
  id: `r${seq++}`, fromNodeId: from, fromName: name, timestamp: at, channelIndex: 0, type: 'reply', kind, replyTo,
});

describe('respondersTo', () => {
  test('one answer per person, latest wins, oldest first', () => {
    const msgs: Message[] = [
      reply(1, 'Ash', 'omw', 100),
      reply(2, 'Bo', 'omw', 200),
      reply(1, 'Ash', 'cant', 300),         // Ash changed their mind
      reply(3, 'Cy', 'omw', 150, 0x2222),   // answers something else
      { id: 't', fromNodeId: 4, fromName: 'Di', timestamp: 50, channelIndex: 0, type: 'text', text: 'hi' },
    ];
    const r = respondersTo(msgs, MEETUP_PKT);
    expect(r.map(x => [x.name, x.kind])).toEqual([['Bo', 'omw'], ['Ash', 'cant']]);
    expect(myAnswer(r, 1)).toBe('cant');
    expect(myAnswer(r, 9)).toBeNull();
    expect(responderSummary(r)).toBe("Bo on the way · Ash can't make it");
  });

  test('an older reply arriving late does not override a newer one', () => {
    const r = respondersTo([reply(1, 'Ash', 'cant', 300), reply(1, 'Ash', 'omw', 100)], MEETUP_PKT);
    expect(r[0].kind).toBe('cant');
  });

  test('a message with no packet id has no responders', () => {
    expect(respondersTo([reply(1, 'Ash', 'omw', 1)], undefined)).toEqual([]);
  });

  test('SOS answers lead the summary', () => {
    const r = respondersTo([reply(1, 'Ash', 'coming', 1), reply(2, 'Bo', 'coming', 2)], MEETUP_PKT);
    expect(responderSummary(r)).toBe('Ash, Bo coming');
  });
});
