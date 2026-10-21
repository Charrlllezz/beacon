import { create } from 'zustand';
import type { FestivalConfig } from '../types/festival';
import { prefetchVenueTiles, isTilesPrefetched } from '../services/map/TilePrefetch';
import { tilesForBounds } from '../services/map/tileMath';

// Offline satellite tiles for the active festival, fetched at launch / on
// foreground / on festival switch rather than only when someone happens to
// open the Map tab. A crew member who opens RNDVU once at home on Wi-Fi
// arrives with the map on their phone. Resumable: tiles already on disk are
// skipped, so each retry only fetches what's missing.

export type OfflineMapStatus =
  | 'idle'
  | 'downloading'
  | 'ready'       // every tile on disk
  | 'incomplete'  // some tiles failed; retried next foreground
  | 'offline';    // no network; nothing more attempted this time

interface OfflineMapState {
  festivalId: string | null;
  status: OfflineMapStatus;
  done: number;
  total: number;
  missing: number;
  ensure: (config: FestivalConfig) => Promise<void>;
}

// Re-render the Device sheet every N tiles rather than on each of ~1,000.
const PROGRESS_STEP = 25;
let inFlight: { festivalId: string; promise: Promise<void> } | null = null;

export const useOfflineMapStore = create<OfflineMapState>((set, get) => ({
  festivalId: null,
  status: 'idle',
  done: 0,
  total: 0,
  missing: 0,

  ensure: (config) => {
    const festivalId = config.festival.id;
    if (inFlight?.festivalId === festivalId) return inFlight.promise;

    const bounds = config.venue.tileBounds ?? config.venue.bounds;
    const total = tilesForBounds(bounds).length;
    if (isTilesPrefetched(bounds)) {
      set({ festivalId, status: 'ready', done: total, total, missing: 0 });
      return Promise.resolve();
    }

    set({ festivalId, status: 'downloading', done: 0, total, missing: 0 });
    // Updates from a run for a festival that's no longer active are dropped
    // (its tiles still land on disk; {z}/{x}/{y} is shared across venues).
    const current = () => get().festivalId === festivalId;
    const promise = prefetchVenueTiles(bounds, (done, t) => {
      if (current() && (done % PROGRESS_STEP === 0 || done === t)) set({ done });
    })
      .then((r) => {
        if (!current()) return;
        if (r.failed === 0) set({ status: 'ready', done: r.total, missing: 0 });
        else set({ status: r.aborted ? 'offline' : 'incomplete', done: r.total - r.failed, missing: r.failed });
      })
      .catch((e) => {
        console.warn('Offline map download failed (will retry):', e);
        if (current()) set({ status: 'incomplete' });
      })
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
    inFlight = { festivalId, promise };
    return promise;
  },
}));
