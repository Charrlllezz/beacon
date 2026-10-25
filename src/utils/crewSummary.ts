import type { CrewMember } from '../types/crew';
import { IN_RANGE_SECS } from './time';

// "Is my crew OK?" in one line, for the strip at the top of every tab.

// "In range" is the app-wide cutoff in time.ts.
export { IN_RANGE_SECS };
export const LOW_BATTERY = 15;

export interface CrewSummary {
  total: number;          // crew members (not you)
  inRange: number;        // heard within IN_RANGE_SECS
  lastHeardSecs: number | null; // most recent packet from anyone
  lowBattery: string[];   // short names at or below LOW_BATTERY
}

export function summarizeCrew(members: CrewMember[], nowSecs = Date.now() / 1000): CrewSummary {
  const crew = members.filter(m => !m.isSelf);
  let inRange = 0;
  let last: number | null = null;
  const lowBattery: string[] = [];
  for (const m of crew) {
    if (m.lastHeard && nowSecs - m.lastHeard < IN_RANGE_SECS) inRange++;
    if (m.lastHeard && (last === null || m.lastHeard > last)) last = m.lastHeard;
    if (m.batteryLevel !== undefined && m.batteryLevel <= LOW_BATTERY) lowBattery.push(m.shortName);
  }
  return { total: crew.length, inRange, lastHeardSecs: last, lowBattery };
}

function ago(secs: number): string {
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  return `${Math.floor(secs / 3600)} h ago`;
}

export type SummaryTone = 'good' | 'partial' | 'none';

export function summaryLine(s: CrewSummary, nowSecs = Date.now() / 1000): { text: string; tone: SummaryTone } {
  if (s.total === 0) return { text: 'No crew heard yet', tone: 'none' };
  const parts = [`${s.inRange} of ${s.total} in range`];
  if (s.lastHeardSecs !== null) parts.push(`last heard ${ago(Math.max(0, nowSecs - s.lastHeardSecs))}`);
  if (s.lowBattery.length === 1) parts.push(`${s.lowBattery[0]} low battery`);
  else if (s.lowBattery.length > 1) parts.push(`${s.lowBattery.length} low battery`);
  const tone: SummaryTone = s.inRange === s.total ? 'good' : s.inRange > 0 ? 'partial' : 'none';
  return { text: parts.join(' · '), tone };
}
