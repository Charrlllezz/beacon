import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CrewMember } from '../types/crew';
import { haversineDistance } from '../utils/coordinates';
import { isOnline } from '../utils/time';

export type CrewSortMode = 'alpha' | 'distance';

// v2: bumped when crew membership stopped being seeded from the radio's entire
// node DB. The old key holds a bloated list (every Meshtastic node the radio
// ever heard) from before the fix; abandoning it clears that on upgrade.
const CREW_STORAGE_KEY = 'rndvu_crew_members_v2';
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
  // True once a phone-GPS fix has set myLocation. Used to stop the T-Echo's
  // coarser self-position from overwriting the accurate phone fix.
  myLocationIsPhone: boolean;
  myColor: string | null;
  focusNodeId: number | null;
  sortMode: CrewSortMode;

  upsertMember: (member: Partial<CrewMember> & { nodeId: number }) => void;
  updateLocation: (nodeId: number, lat: number, lng: number, atSecs?: number) => void;
  updateBattery: (nodeId: number, level: number) => void;
  updateColor: (nodeId: number, color: string) => void;
  updateSnr: (nodeId: number, snr: number) => void;
  touchLastHeard: (nodeId: number, lastHeardSeconds: number) => void;
  setMyLocation: (lat: number, lng: number, fromPhone?: boolean) => void;
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
  myLocationIsPhone: false,
  myColor: null,
  focusNodeId: null,
  sortMode: 'alpha' as CrewSortMode,

  upsertMember: (partial) =>
    set((state) => {
      const existing = state.crewMembers[partial.nodeId];
      // Don't create a NEW crew member from stale data. On connect the radio
      // streams its ENTIRE node DB (every Meshtastic node it has ever heard) as
      // NodeInfo; without this gate, all of them became "crew" (the 35+ random
      // nodes). Only create when the node was heard recently (live RNDVU
      // traffic). Already-known members are always enriched/updated below.
      if (!existing && partial.lastHeard !== undefined && !isOnline(partial.lastHeard)) {
        return state;
      }
      // Drop keys that are present but undefined: the radio's stored record
      // often lacks battery or last-heard, and spreading those undefineds
      // wiped a peer's known "6%" (and its low-battery warning) on reconnect.
      const known = Object.fromEntries(
        Object.entries(partial).filter(([, v]) => v !== undefined),
      ) as typeof partial;
      // Never move last-heard backwards: a replayed record is older than the
      // packet we just heard from them.
      const lastHeard = Math.max(known.lastHeard ?? 0, existing?.lastHeard ?? 0) || undefined;
      return {
        crewMembers: {
          ...state.crewMembers,
          [partial.nodeId]: {
            ...existing,
            ...known,
            lastHeard,
            nodeId: partial.nodeId,
            // Use || not ?? so empty-string name from an unconfigured T-Echo
            // falls back to existing or 'Unknown' instead of rendering blank.
            longName: partial.longName || existing?.longName || 'Unknown',
            shortName: partial.shortName || existing?.shortName || '???',
            isOnline: partial.isOnline ?? isOnline(lastHeard),
          },
        },
      };
    }),

  // The five helpers below no-op when we don't already have a crew entry.
  // Packet-only updates (POSITION, TELEMETRY, text dedup, etc.) must not
  // synthesize "Unknown / ???" stubs before NodeInfo arrives, or the crew
  // list fills with ghosts. Once upsertMember creates a real entry, these
  // updates then apply.
  updateLocation: (nodeId, lat, lng, atSecs = Math.floor(Date.now() / 1000)) =>
    set((state) => {
      const existing = state.crewMembers[nodeId];
      if (!existing) return state;
      // The radio's node DB replays old positions on connect. Don't let an
      // older fix replace a newer one (or make a pin look fresher than it is).
      if (existing.locationAt && atSecs < existing.locationAt) return state;
      return {
        crewMembers: {
          ...state.crewMembers,
          [nodeId]: { ...existing, lat, lng, locationAt: atSecs },
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

  setMyLocation: (lat, lng, fromPhone = false) =>
    set((state) => {
      // Phone GPS (high accuracy, via expo-location) wins over the T-Echo's own
      // self-position. Once we have a phone fix, ignore radio self-position so
      // it can't drag the user's dot to a stale/coarse location.
      if (!fromPhone && state.myLocationIsPhone) return state;
      return {
        myLocation: { lat, lng },
        myLocationIsPhone: fromPhone ? true : state.myLocationIsPhone,
      };
    }),

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
