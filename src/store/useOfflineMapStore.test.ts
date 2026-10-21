import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { FestivalConfig } from '../types/festival';

const tp = vi.hoisted(() => ({
  prefetched: new Set<string>(),
  calls: 0,
  // Resolved by the test to finish the current download.
  finish: null as null | ((r: { total: number; failed: number; aborted: boolean }) => void),
  progress: null as null | ((done: number, total: number) => void),
}));
vi.mock('../services/map/TilePrefetch', () => ({
  isTilesPrefetched: (b: any) => tp.prefetched.has(JSON.stringify(b)),
  prefetchVenueTiles: (_b: any, onProgress: any) => {
    tp.calls++;
    tp.progress = onProgress;
    return new Promise(r => { tp.finish = r; });
  },
}));

import { useOfflineMapStore } from './useOfflineMapStore';
import { BUNDLED_FESTIVALS } from '../services/festival/festivals';

const nye = BUNDLED_FESTIVALS.find(c => c.festival.id === 'countdown-nye-2026')!;
const coachella = BUNDLED_FESTIVALS.find(c => c.festival.id === 'coachella-w2-2026')!;
const boundsOf = (c: FestivalConfig) => JSON.stringify(c.venue.tileBounds ?? c.venue.bounds);
const flush = () => new Promise(r => setTimeout(r, 0));

describe('useOfflineMapStore', () => {
  beforeEach(() => {
    tp.prefetched.clear();
    tp.calls = 0;
    useOfflineMapStore.setState({ festivalId: null, status: 'idle', done: 0, total: 0, missing: 0 });
  });

  test('already on disk: ready without downloading', async () => {
    tp.prefetched.add(boundsOf(nye));
    await useOfflineMapStore.getState().ensure(nye);
    expect(useOfflineMapStore.getState()).toMatchObject({ status: 'ready', done: 1034, total: 1034 });
    expect(tp.calls).toBe(0);
  });

  test('downloads with progress, single-flight, then ready', async () => {
    const p = useOfflineMapStore.getState().ensure(nye);
    useOfflineMapStore.getState().ensure(nye); // launch + foreground at once
    expect(tp.calls).toBe(1);
    expect(useOfflineMapStore.getState()).toMatchObject({ status: 'downloading', total: 1034 });
    tp.progress!(500, 1034);
    expect(useOfflineMapStore.getState().done).toBe(500);
    tp.finish!({ total: 1034, failed: 0, aborted: false });
    await p;
    expect(useOfflineMapStore.getState()).toMatchObject({ status: 'ready', done: 1034, missing: 0 });
  });

  test('partial failure → incomplete; no network → offline', async () => {
    let p = useOfflineMapStore.getState().ensure(nye);
    tp.finish!({ total: 1034, failed: 12, aborted: false });
    await p;
    expect(useOfflineMapStore.getState()).toMatchObject({ status: 'incomplete', missing: 12 });

    p = useOfflineMapStore.getState().ensure(nye);
    tp.finish!({ total: 1034, failed: 1034, aborted: true });
    await p;
    expect(useOfflineMapStore.getState()).toMatchObject({ status: 'offline', missing: 1034 });
  });

  test('switching festival mid-download: the old run cannot overwrite the new status', async () => {
    const old = useOfflineMapStore.getState().ensure(coachella);
    const finishOld = tp.finish!;
    tp.prefetched.add(boundsOf(nye));
    await useOfflineMapStore.getState().ensure(nye);
    finishOld({ total: 2746, failed: 5, aborted: false });
    await old;
    await flush();
    expect(useOfflineMapStore.getState()).toMatchObject({ festivalId: 'countdown-nye-2026', status: 'ready' });
  });
});
