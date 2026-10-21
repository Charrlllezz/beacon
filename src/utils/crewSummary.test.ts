import { describe, test, expect } from 'vitest';
import { summarizeCrew, summaryLine, IN_RANGE_SECS } from './crewSummary';
import type { CrewMember } from '../types/crew';

const NOW = 1_800_000_000;
const m = (shortName: string, ageSecs?: number, battery?: number, isSelf = false): CrewMember => ({
  nodeId: shortName.charCodeAt(0),
  longName: shortName,
  shortName,
  lastHeard: ageSecs === undefined ? undefined : NOW - ageSecs,
  batteryLevel: battery,
  isOnline: true,
  isSelf,
});

describe('summarizeCrew', () => {
  test('counts who is in range, leaves you out', () => {
    const s = summarizeCrew([m('ME', 0, 50, true), m('ASH', 60), m('BO', IN_RANGE_SECS + 1), m('CY', undefined)], NOW);
    expect(s).toEqual({ total: 3, inRange: 1, lastHeardSecs: NOW - 60, lowBattery: [] });
  });

  test('flags low radio batteries, but not USB power (101)', () => {
    const s = summarizeCrew([m('ASH', 60, 12), m('BO', 60, 101), m('CY', 60, 15)], NOW);
    expect(s.lowBattery).toEqual(['ASH', 'CY']);
  });
});

describe('summaryLine', () => {
  test('everyone in range', () => {
    const line = summaryLine(summarizeCrew([m('ASH', 120), m('BO', 30)], NOW), NOW);
    expect(line).toEqual({ text: '2 of 2 in range · last heard just now', tone: 'good' });
  });

  test('some out of range, one low battery', () => {
    const line = summaryLine(summarizeCrew([m('ASH', 300, 9), m('BO', 7200)], NOW), NOW);
    expect(line).toEqual({ text: '1 of 2 in range · last heard 5 min ago · ASH low battery', tone: 'partial' });
  });

  test('nobody in range', () => {
    const line = summaryLine(summarizeCrew([m('ASH', 7200, 10), m('BO', 9000, 5)], NOW), NOW);
    expect(line).toEqual({ text: '0 of 2 in range · last heard 2 h ago · 2 low battery', tone: 'none' });
  });

  test('no crew yet', () => {
    expect(summaryLine(summarizeCrew([m('ME', 0, 80, true)], NOW), NOW)).toEqual({ text: 'No crew heard yet', tone: 'none' });
  });
});
