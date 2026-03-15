import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CrewMember } from '../types/crew';
import { haversineDistance } from '../utils/coordinates';
import { isOnline } from '../utils/time';

export type CrewSortMode = 'alpha' | 'distance';

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
  setMyLocation: (lat: number, lng: number) => void;
  setMyColor: (color: string) => void;
  loadMyColor: () => Promise<void>;
  setFocusNode: (nodeId: number | null) => void;
  setSortMode: (mode: CrewSortMode) => void;
  getOnlineMembers: () => CrewMember[];
  getSortedMembers: () => CrewMember[];
  getDistanceTo: (nodeId: number) => number | null;
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
            longName: partial.longName ?? existing?.longName ?? 'Unknown',
            shortName: partial.shortName ?? existing?.shortName ?? '???',
            isOnline: partial.isOnline ?? isOnline(partial.lastHeard ?? existing?.lastHeard),
          },
        },
      };
    }),

  updateLocation: (nodeId, lat, lng) =>
    set((state) => ({
      crewMembers: {
        ...state.crewMembers,
        [nodeId]: state.crewMembers[nodeId]
          ? { ...state.crewMembers[nodeId], lat, lng }
          : { nodeId, lat, lng, longName: 'Unknown', shortName: '???', isOnline: true },
      },
    })),

  updateBattery: (nodeId, level) =>
    set((state) => ({
      crewMembers: {
        ...state.crewMembers,
        [nodeId]: state.crewMembers[nodeId]
          ? { ...state.crewMembers[nodeId], batteryLevel: level }
          : { nodeId, batteryLevel: level, longName: 'Unknown', shortName: '???', isOnline: true },
      },
    })),

  updateColor: (nodeId, color) =>
    set((state) => ({
      crewMembers: {
        ...state.crewMembers,
        [nodeId]: state.crewMembers[nodeId]
          ? { ...state.crewMembers[nodeId], color }
          : { nodeId, color, longName: 'Unknown', shortName: '???', isOnline: true },
      },
    })),

  updateSnr: (nodeId, snr) =>
    set((state) => ({
      crewMembers: {
        ...state.crewMembers,
        [nodeId]: state.crewMembers[nodeId]
          ? { ...state.crewMembers[nodeId], snr }
          : { nodeId, snr, longName: 'Unknown', shortName: '???', isOnline: true },
      },
    })),

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
    AsyncStorage.setItem('beacon_my_color', color);
  },

  loadMyColor: async () => {
    const color = await AsyncStorage.getItem('beacon_my_color');
    if (color) set({ myColor: color });
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
}));
