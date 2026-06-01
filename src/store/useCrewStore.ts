import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CrewMember } from '../types/crew';
import { haversineDistance } from '../utils/coordinates';
import { isOnline } from '../utils/time';

export type CrewSortMode = 'alpha' | 'distance';

const CREW_STORAGE_KEY = 'rndvu_crew_members';
const PERSIST_DEBOUNCE_MS = 2000;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const crewMembers = useCrewStore.getState().crewMembers;
    AsyncStorage.setItem(CREW_STORAGE_KEY, JSON.stringify(crewMembers)).catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
}

interface CrewState {
  crewMembers: Record<number, CrewMember>;
  myLocation: { lat: number; lng: number } | null;
  myColor: string | null;
  focusNodeId: number | null;
  sortMode: CrewSortMode;

  upsertMember: (member: Partial<CrewMember> & { nodeId: number }) => void;
  updateLocation: (nodeId: number, lat: number, lng: number) => void;
  updateBattery: (nodeId: number, level: number) => void;
  updateColor: (nodeId: number, color: string) => void;
  updateSnr: (nodeId: number, snr: number) => void;
  touchLastHeard: (nodeId: number, lastHeardSeconds: number) => void;
  setMyLocation: (lat: number, lng: number) => void;
  setMyColor: (color: string) => void;
  loadMyColor: () => Promise<void>;
  loadCrewMembers: () => Promise<void>;
  setFocusNode: (nodeId: number | null) => void;
  setSortMode: (mode: CrewSortMode) => void;
  getOnlineMembers: () => CrewMember[];
  getSortedMembers: () => CrewMember[];
  getDistanceTo: (nodeId: number) => number | null;
  setDisplayName: (longName: string, shortName: string) => void;
  loadDisplayName: () => Promise<{ longName: string; shortName: string } | null>;
}

export const useCrewStore = create<CrewState>((set, get) => ({
  crewMembers: {},
  myLocation: null,
  myColor: null,
  focusNodeId: null,
  sortMode: 'alpha' as CrewSortMode,

  upsertMember: (partial) =>
    set((state) => {
      const existing = state.crewMembers[partial.nodeId];
      return {
        crewMembers: {
          ...state.crewMembers,
          [partial.nodeId]: {
            ...existing,
            ...partial,
            nodeId: partial.nodeId,
            // Use || not ?? so empty-string name from an unconfigured T-Echo
            // falls back to existing or 'Unknown' instead of rendering blank.
            longName: partial.longName || existing?.longName || 'Unknown',
            shortName: partial.shortName || existing?.shortName || '???',
            isOnline: partial.isOnline ?? isOnline(partial.lastHeard ?? existing?.lastHeard),
          },
        },
      };
    }),

  // The five helpers below no-op when we don't already have a crew entry.
  // Packet-only updates (POSITION, TELEMETRY, text dedup, etc.) must not
  // synthesize "Unknown / ???" stubs before NodeInfo arrives, or the crew
  // list fills with ghosts. Once upsertMember creates a real entry, these
  // updates then apply.
  updateLocation: (nodeId, lat, lng) =>
    set((state) => {
      if (!state.crewMembers[nodeId]) return state;
      return {
        crewMembers: {
          ...state.crewMembers,
          [nodeId]: { ...state.crewMembers[nodeId], lat, lng },
        },
      };
    }),

  updateBattery: (nodeId, level) =>
    set((state) => {
      if (!state.crewMembers[nodeId]) return state;
      return {
        crewMembers: {
          ...state.crewMembers,
          [nodeId]: { ...state.crewMembers[nodeId], batteryLevel: Math.min(level, 100) },
        },
      };
    }),

  updateColor: (nodeId, color) =>
    set((state) => {
      if (!state.crewMembers[nodeId]) return state;
      return {
        crewMembers: {
          ...state.crewMembers,
          [nodeId]: { ...state.crewMembers[nodeId], color },
        },
      };
    }),

  updateSnr: (nodeId, snr) =>
    set((state) => {
      if (!state.crewMembers[nodeId]) return state;
      return {
        crewMembers: {
          ...state.crewMembers,
          [nodeId]: { ...state.crewMembers[nodeId], snr },
        },
      };
    }),

  touchLastHeard: (nodeId, lastHeardSeconds) =>
    set((state) => {
      if (!state.crewMembers[nodeId]) return state;
      return {
        crewMembers: {
          ...state.crewMembers,
          [nodeId]: { ...state.crewMembers[nodeId], lastHeard: lastHeardSeconds, isOnline: true },
        },
      };
    }),

  setFocusNode: (nodeId) => set({ focusNodeId: nodeId }),

  setSortMode: (mode) => set({ sortMode: mode }),

  setMyLocation: (lat, lng) => set({ myLocation: { lat, lng } }),

  setMyColor: (color) => {
    set((state) => {
      const self = Object.values(state.crewMembers).find(m => m.isSelf);
      return {
        myColor: color,
        crewMembers: self
          ? { ...state.crewMembers, [self.nodeId]: { ...state.crewMembers[self.nodeId], color } }
          : state.crewMembers,
      };
    });
    AsyncStorage.setItem('rndvu_my_color', color);
  },

  loadMyColor: async () => {
    const color = await AsyncStorage.getItem('rndvu_my_color');
    if (color) set({ myColor: color });
  },

  loadCrewMembers: async () => {
    try {
      const raw = await AsyncStorage.getItem(CREW_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<number, CrewMember>;
      // Age out peers we haven't heard from in >7 days. Keeps the crew list
      // from accumulating ghosts across months of testing, and keeps self.
      const STALE_CUTOFF_SECS = 7 * 24 * 3600;
      const nowSec = Math.floor(Date.now() / 1000);
      const crewMembers: Record<number, CrewMember> = {};
      for (const [idStr, m] of Object.entries(stored)) {
        if (m.isSelf) { crewMembers[Number(idStr)] = m; continue; }
        if (!m.lastHeard) { crewMembers[Number(idStr)] = m; continue; }
        if (nowSec - m.lastHeard < STALE_CUTOFF_SECS) {
          crewMembers[Number(idStr)] = m;
        }
      }
      set({ crewMembers });
    } catch {}
  },

  getOnlineMembers: () =>
    Object.values(get().crewMembers).filter((m) => !m.isSelf && isOnline(m.lastHeard)),

  getSortedMembers: () => {
    const { crewMembers, myLocation, sortMode } = get();
    const members = Object.values(crewMembers).filter((m) => !m.isSelf);
    return members.sort((a, b) => {
      const aOnline = isOnline(a.lastHeard) ? 1 : 0;
      const bOnline = isOnline(b.lastHeard) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      if (sortMode === 'distance' && myLocation) {
        const aDist = a.lat && a.lng ? haversineDistance(myLocation.lat, myLocation.lng, a.lat, a.lng) : Infinity;
        const bDist = b.lat && b.lng ? haversineDistance(myLocation.lat, myLocation.lng, b.lat, b.lng) : Infinity;
        if (aDist !== bDist) return aDist - bDist;
      }
      return a.longName.localeCompare(b.longName);
    });
  },

  getDistanceTo: (nodeId) => {
    const { myLocation, crewMembers } = get();
    const member = crewMembers[nodeId];
    if (!myLocation || !member?.lat || !member?.lng) return null;
    return haversineDistance(myLocation.lat, myLocation.lng, member.lat, member.lng);
  },

  setDisplayName: (longName, shortName) => {
    set((state) => {
      const self = Object.values(state.crewMembers).find(m => m.isSelf);
      if (!self) return state;
      return {
        crewMembers: {
          ...state.crewMembers,
          [self.nodeId]: { ...state.crewMembers[self.nodeId], longName, shortName },
        },
      };
    });
    AsyncStorage.setItem('rndvu_display_name', JSON.stringify({ longName, shortName }));
  },

  loadDisplayName: async () => {
    try {
      const raw = await AsyncStorage.getItem('rndvu_display_name');
      if (raw) return JSON.parse(raw) as { longName: string; shortName: string };
    } catch {}
    return null;
  },
}));

// Persist crewMembers on any change (debounced). Survives cold start so the
// crew list doesn't go empty while waiting for the T-Echo's nodedb drain.
useCrewStore.subscribe((state, prev) => {
  if (state.crewMembers !== prev.crewMembers) {
    scheduleSave();
  }
});
