import { describe, test, expect } from 'vitest';
import { debriefStats, formatDebrief, shouldOfferDebrief, festivalWindow, debriefTarget } from './debrief';
import type { FestivalConfig } from '../types/festival';
import type { Message } from '../types/messages';
import type { CrewMember } from '../types/crew';

const config = {
  festival: {
    id: 'countdown-nye-2026', name: 'Countdown NYE 2026', shortName: 'Countdown NYE',
    dates: { start: '2026-12-31T00:00:00-08:00', end: '2027-01-01T00:00:00-08:00' },
    timezone: 'America/Los_Angeles',
  },
} as FestivalConfig;

const ME = 9, ASH = 1, BO = 2;
const NYE_11PM = new Date('2026-12-31T23:00:00-08:00').getTime();
const AFTER_MIDNIGHT = new Date('2027-01-01T01:30:00-08:00').getTime();
let n = 0;
const m = (p: Partial<Message> & Pick<Message, 'type' | 'fromNodeId'>): Message =>
  ({ id: `m${n++}`, fromName: 'x', timestamp: NYE_11PM, channelIndex: 0, ...p } as Message);

describe('debriefStats', () => {
  test('counts the festival night, including after midnight, and nothing else', () => {
    const messages: Message[] = [
      m({ type: 'text', fromNodeId: ME, text: 'hi', sendStatus: 'sent' }),
      m({ type: 'text', fromNodeId: ME, text: 'lost', sendStatus: 'failed', timestamp: AFTER_MIDNIGHT }),
      m({ type: 'meetup', fromNodeId: ME, hour: 23, minute: 30, location: 'Gate', packetId: 77 }),
      m({ type: 'rally', fromNodeId: ME, lat: 1, lng: 1, packetId: 78 }),
      m({ type: 'reply', fromNodeId: ASH, kind: 'omw', replyTo: 77 }),
      m({ type: 'sos', fromNodeId: ME, lat: 1, lng: 1, packetId: 80 }),
      m({ type: 'sos', fromNodeId: ME, lat: 1, lng: 1, replyTo: 80 }),  // a repeat
      m({ type: 'text', fromNodeId: ASH, text: 'yo' }),
      m({ type: 'color', fromNodeId: BO, color: '#fff' }),               // ambient
      m({ type: 'text', fromNodeId: BO, text: 'last week', timestamp: NYE_11PM - 7 * 86400e3 }),
    ];
    const crew: CrewMember[] = [
      { nodeId: ME, longName: 'Me', shortName: 'ME', isOnline: true, isSelf: true, batteryLevel: 41 },
      { nodeId: BO, longName: 'Bo', shortName: 'BO', isOnline: true, lastHeard: Math.floor(AFTER_MIDNIGHT / 1000) },
    ];
    expect(debriefStats(config, messages, crew, ME, '2.7.26.54e0d8d')).toEqual({
      festivalId: 'countdown-nye-2026',
      sent: 6, failed: 1, received: 2, crewHeard: 2,
      myCardsAnswered: '1 of 2', sosSent: 1, radioBattery: 41, firmware: '2.7.26.54e0d8d',
    });
  });
});

describe('when to offer it', () => {
  const end = new Date(config.festival.dates.end).getTime();
  test('from the morning after, for two weeks', () => {
    expect(shouldOfferDebrief(config, AFTER_MIDNIGHT)).toBe(false);
    expect(shouldOfferDebrief(config, end + 6 * 3600e3)).toBe(true);
    expect(shouldOfferDebrief(config, end + 13 * 86400e3)).toBe(true);
    expect(shouldOfferDebrief(config, end + 15 * 86400e3)).toBe(false);
  });

  test('the window covers the night past midnight', () => {
    const w = festivalWindow(config);
    expect(AFTER_MIDNIGHT).toBeGreaterThan(w.start);
    expect(AFTER_MIDNIGHT).toBeLessThan(w.end);
  });
});

describe('formatDebrief', () => {
  test('plain text with answers and measurements', () => {
    const text = formatDebrief('Ash', 'Countdown NYE 2026',
      { delivery: 'mostly', phoneBattery: 'under20', wouldPay: null, confusing: ' ' },
      { festivalId: 'x', sent: 6, failed: 1, received: 2, crewHeard: 2, myCardsAnswered: '1 of 2', sosSent: 0, radioBattery: 101, firmware: null });
    expect(text).toContain('RNDVU debrief: Countdown NYE 2026 (Ash)');
    expect(text).toContain('Messages got through: mostly');
    expect(text).toContain('Phone battery at the end: under 20%');
    expect(text).toContain('Would pay next time: (skipped)');
    expect(text).toContain('Confusing: (nothing)');
    expect(text).toContain('- Sent 6 (1 failed), received 2');
    expect(text).toContain('- Radio battery now: USB');
  });
});

describe('debriefTarget', () => {
  const bw = {
    festival: { ...config.festival, id: 'beyond-wonderland-2027', dates: { start: '2027-03-26T00:00:00-07:00', end: '2027-03-28T00:00:00-07:00' } },
  } as FestivalConfig;

  test('stays on Countdown after the app switches to BW', () => {
    const jan3 = new Date('2027-01-03T12:00:00-08:00').getTime();
    expect(debriefTarget([config, bw], jan3)?.festival.id).toBe('countdown-nye-2026');
    expect(shouldOfferDebrief(config, jan3)).toBe(true);
  });

  test('moves to BW once BW begins, and is null before anything', () => {
    expect(debriefTarget([config, bw], new Date('2027-03-27T12:00:00-07:00').getTime())?.festival.id).toBe('beyond-wonderland-2027');
    expect(debriefTarget([config, bw], new Date('2026-11-01T00:00:00-08:00').getTime())).toBeNull();
  });
});
