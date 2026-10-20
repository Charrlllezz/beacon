import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GpsPoint } from '../types/festival';
import { BUNDLED_FESTIVALS } from '../services/festival/festivals';
import { pickFestival, type SelectionReason } from '../services/festival/FestivalSelection';

const OVERRIDE_KEY = 'rndvu_festival_override';

interface FestivalState {
  activeId: string;
  reason: SelectionReason;
  // Manual pick from the Device sheet; null = automatic (date + location).
  overrideId: string | null;

  /** Re-run the automatic pick. Cheap; call on launch, first GPS fix, foreground. */
  refresh: (now?: Date, location?: GpsPoint | null) => void;
  setOverride: (id: string | null) => void;
  loadOverride: () => Promise<void>;
}

const initial = pickFestival(BUNDLED_FESTIVALS, new Date(), null);
let lastLocation: GpsPoint | null = null;

export const useFestivalStore = create<FestivalState>((set, get) => ({
  activeId: initial.config.festival.id,
  reason: initial.reason,
  overrideId: null,

  refresh: (now = new Date(), location) => {
    if (location !== undefined) lastLocation = location;
    const sel = pickFestival(BUNDLED_FESTIVALS, now, lastLocation, get().overrideId);
    // Only write on change: screens are keyed on activeId and remount.
    if (sel.config.festival.id !== get().activeId || sel.reason !== get().reason) {
      set({ activeId: sel.config.festival.id, reason: sel.reason });
    }
  },

  setOverride: (id) => {
    set({ overrideId: id });
    if (id) AsyncStorage.setItem(OVERRIDE_KEY, id).catch(() => {});
    else AsyncStorage.removeItem(OVERRIDE_KEY).catch(() => {});
    get().refresh();
  },

  loadOverride: async () => {
    try {
      const id = await AsyncStorage.getItem(OVERRIDE_KEY);
      // Ignore an override for a festival this build no longer bundles.
      if (id && BUNDLED_FESTIVALS.some(c => c.festival.id === id)) set({ overrideId: id });
    } catch {}
    get().refresh();
  },
}));
