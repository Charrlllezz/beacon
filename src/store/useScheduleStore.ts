import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GOING_KEY = 'rndvu_my_going_picks';

interface GoingEntry {
  nodeId: number;
  nodeName: string;
  stageId: string;
  artistId: string;
  timestamp: number;
}

interface MyGoingPick {
  stageId: string;
  artistId: string;
}

interface ScheduleState {
  goingEntries: GoingEntry[];
  myGoingPicks: MyGoingPick[];

  addGoingEntry: (entry: GoingEntry) => void;
  removeGoingEntry: (nodeId: number, stageId: string, artistId: string) => void;
  toggleMyGoing: (stageId: string, artistId: string) => void;
  isMyGoing: (stageId: string, artistId: string) => boolean;
  getGoingForArtist: (stageId: string, artistId: string) => GoingEntry[];
  getMyCrewAtStage: (stageId: string) => GoingEntry[];
  getActivePickForNode: (nodeId: number, nowPlayingLookup: (stageId: string, artistId: string) => boolean) => GoingEntry | null;
  loadMyGoingPicks: () => Promise<void>;
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  goingEntries: [],
  myGoingPicks: [],

  addGoingEntry: (entry) =>
    set((state) => ({
      goingEntries: [
        // deduplicate by (nodeId, stageId, artistId)
        ...state.goingEntries.filter(
          (e) => !(e.nodeId === entry.nodeId && e.stageId === entry.stageId && e.artistId === entry.artistId)
        ),
        entry,
      ],
    })),

  removeGoingEntry: (nodeId, stageId, artistId) =>
    set((state) => ({
      goingEntries: state.goingEntries.filter(
        (e) => !(e.nodeId === nodeId && e.stageId === stageId && e.artistId === artistId)
      ),
    })),

  toggleMyGoing: (stageId, artistId) =>
    set((state) => {
      const exists = state.myGoingPicks.some(
        (p) => p.stageId === stageId && p.artistId === artistId
      );
      const myGoingPicks = exists
        ? state.myGoingPicks.filter((p) => !(p.stageId === stageId && p.artistId === artistId))
        : [...state.myGoingPicks, { stageId, artistId }];
      AsyncStorage.setItem(GOING_KEY, JSON.stringify(myGoingPicks)).catch(() => {});
      return { myGoingPicks };
    }),

  isMyGoing: (stageId, artistId) =>
    get().myGoingPicks.some((p) => p.stageId === stageId && p.artistId === artistId),

  getGoingForArtist: (stageId, artistId) =>
    get().goingEntries.filter(
      (e) => e.stageId === stageId && e.artistId === artistId
    ),

  getMyCrewAtStage: (stageId) =>
    get().goingEntries.filter((e) => e.stageId === stageId),

  getActivePickForNode: (nodeId, nowPlayingLookup) => {
    const entries = get().goingEntries.filter((e) => e.nodeId === nodeId);
    return entries.find((e) => nowPlayingLookup(e.stageId, e.artistId)) ?? null;
  },

  loadMyGoingPicks: async () => {
    try {
      const raw = await AsyncStorage.getItem(GOING_KEY);
      if (raw) {
        set({ myGoingPicks: JSON.parse(raw) });
      }
    } catch {}
  },
}));
