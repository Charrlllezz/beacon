import type { Message } from '../types/messages';
import type { CrewMember } from '../types/crew';
import type { FestivalConfig } from '../types/festival';

// The end-of-trip debrief: a few questions plus what the phone measured
// during the festival, saved on the phone and shared as text (iMessage,
// email) with whoever runs the trip. It's how Beyond Wonderland is measured.

export type Delivery = 'always' | 'mostly' | 'sometimes' | 'rarely';
export type PhoneBattery = 'over50' | '20to50' | 'under20' | 'died';
export type WouldPay = 'yes' | 'maybe' | 'no';

export interface DebriefAnswers {
  delivery: Delivery | null;
  phoneBattery: PhoneBattery | null;
  wouldPay: WouldPay | null;
  confusing: string;
}

export interface DebriefStats {
  festivalId: string;
  sent: number;            // my crew messages (chat, rally, meetup, SOS, answers)
  failed: number;          // of those, never reached my radio
  received: number;        // from the crew
  crewHeard: number;       // people heard during the festival
  myCardsAnswered: string; // "3 of 4": my rally points / meetups someone answered
  sosSent: number;
  radioBattery: number | null; // my radio, now
  firmware: string | null;
}

// Window counted as "the festival": arrival day to the morning after.
const WINDOW_LEAD_MS = 12 * 3600 * 1000;
const WINDOW_TRAIL_MS = 12 * 3600 * 1000;
// The app offers the debrief from the morning after, for two weeks.
const PROMPT_AFTER_MS = 6 * 3600 * 1000;
const PROMPT_FOR_MS = 14 * 24 * 3600 * 1000;

const AMBIENT: ReadonlySet<Message['type']> = new Set(['color', 'ungoing', 'going', 'tag', 'heading']);

export function festivalWindow(c: FestivalConfig): { start: number; end: number } {
  return {
    start: new Date(c.festival.dates.start).getTime() - WINDOW_LEAD_MS,
    end: new Date(c.festival.dates.end).getTime() + WINDOW_TRAIL_MS,
  };
}

export function shouldOfferDebrief(c: FestivalConfig, nowMs: number): boolean {
  const end = new Date(c.festival.dates.end).getTime();
  return nowMs >= end + PROMPT_AFTER_MS && nowMs < end + PROMPT_FOR_MS;
}

/**
 * Which festival a debrief is about: the latest one that has begun. Not the
 * active festival: Countdown and Beyond Wonderland share a venue, and once
 * Countdown's window closes (Jan 2) the app switches to BW, which hid the
 * Countdown prompt and saved its debrief under BW's id.
 */
export function debriefTarget(configs: FestivalConfig[], nowMs: number): FestivalConfig | null {
  const begun = configs.filter(c => festivalWindow(c).start <= nowMs);
  if (begun.length === 0) return null;
  return begun.reduce((a, b) => (festivalWindow(b).start > festivalWindow(a).start ? b : a));
}

export function debriefStats(
  c: FestivalConfig,
  messages: Message[],
  crew: CrewMember[],
  myNodeNum: number | null,
  firmware: string | null,
): DebriefStats {
  const w = festivalWindow(c);
  const inWindow = messages.filter(m => m.timestamp >= w.start && m.timestamp <= w.end && !AMBIENT.has(m.type));
  const mine = inWindow.filter(m => myNodeNum !== null && m.fromNodeId === myNodeNum);
  const theirs = inWindow.filter(m => m.fromNodeId !== myNodeNum);

  const heard = new Set(theirs.map(m => m.fromNodeId));
  for (const p of crew) {
    if (!p.isSelf && p.lastHeard && p.lastHeard * 1000 >= w.start && p.lastHeard * 1000 <= w.end) heard.add(p.nodeId);
  }

  const myCards = mine.filter(m => (m.type === 'rally' || m.type === 'meetup') && m.packetId);
  const answered = myCards.filter(card =>
    messages.some(r => r.type === 'reply' && r.replyTo === card.packetId && r.fromNodeId !== myNodeNum));

  const self = crew.find(p => p.isSelf);
  return {
    festivalId: c.festival.id,
    sent: mine.length,
    failed: mine.filter(m => m.sendStatus === 'failed').length,
    received: theirs.length,
    crewHeard: heard.size,
    myCardsAnswered: `${answered.length} of ${myCards.length}`,
    sosSent: mine.filter(m => m.type === 'sos' && !m.replyTo).length,
    radioBattery: self?.batteryLevel ?? null,
    firmware,
  };
}

const DELIVERY_TEXT: Record<Delivery, string> = {
  always: 'always', mostly: 'mostly', sometimes: 'sometimes', rarely: 'rarely',
};
const BATTERY_TEXT: Record<PhoneBattery, string> = {
  over50: 'over 50%', '20to50': '20–50%', under20: 'under 20%', died: 'died',
};

/** The text that gets shared. Plain, so it reads fine in iMessage or email. */
export function formatDebrief(name: string, festivalName: string, a: DebriefAnswers, s: DebriefStats): string {
  const q = (v: string | null) => v ?? '(skipped)';
  return [
    `RNDVU debrief: ${festivalName} (${name})`,
    '',
    `Messages got through: ${q(a.delivery && DELIVERY_TEXT[a.delivery])}`,
    `Phone battery at the end: ${q(a.phoneBattery && BATTERY_TEXT[a.phoneBattery])}`,
    `Would pay next time: ${q(a.wouldPay)}`,
    `Confusing: ${a.confusing.trim() || '(nothing)'}`,
    '',
    'Measured by the app:',
    `- Sent ${s.sent} (${s.failed} failed), received ${s.received}`,
    `- Crew heard: ${s.crewHeard}`,
    `- My rally points/meetups answered: ${s.myCardsAnswered}`,
    `- SOS sent: ${s.sosSent}`,
    `- Radio battery now: ${s.radioBattery === null ? 'unknown' : s.radioBattery > 100 ? 'USB' : `${s.radioBattery}%`}`,
    `- Firmware: ${s.firmware ?? 'unknown'}`,
  ].join('\n');
}
