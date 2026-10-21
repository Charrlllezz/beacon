import { describe, test, expect, vi, beforeEach } from 'vitest';

const data = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => { data.set(k, v); },
    removeItem: async (k: string) => { data.delete(k); },
  },
}));

import { useFestivalStore } from './useFestivalStore';
import { festivalConfig } from '../services/festival/FestivalConfig';

describe('useFestivalStore', () => {
  beforeEach(() => {
    data.clear();
    useFestivalStore.setState({ overrideId: null });
    useFestivalStore.getState().refresh(new Date('2026-12-31T20:00:00-08:00'), null);
  });

  test('festivalConfig reads whatever is active', () => {
    expect(useFestivalStore.getState().activeId).toBe('countdown-nye-2026');
    expect(festivalConfig.getConfig().venue.name).toBe('NOS Events Center, San Bernardino');
    expect(festivalConfig.getAllStages()).toEqual([]);
  });

  test('override switches immediately and persists; clearing returns to automatic', async () => {
    useFestivalStore.getState().setOverride('coachella-w2-2026');
    expect(useFestivalStore.getState()).toMatchObject({ activeId: 'coachella-w2-2026', reason: 'override' });
    expect(festivalConfig.getAllStages().length).toBeGreaterThan(0);
    await Promise.resolve();
    expect(data.get('rndvu_festival_override')).toBe('coachella-w2-2026');

    useFestivalStore.getState().setOverride(null);
    await Promise.resolve();
    expect(data.has('rndvu_festival_override')).toBe(false);
    expect(useFestivalStore.getState().reason).not.toBe('override');
  });

  test('a stored override for a festival no longer bundled is ignored', async () => {
    data.set('rndvu_festival_override', 'some-festival-2025');
    await useFestivalStore.getState().loadOverride();
    expect(useFestivalStore.getState().overrideId).toBeNull();
  });
});
