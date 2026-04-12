import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TaggedPOI, TagCategory } from '../types/festival';

const STORAGE_KEY = 'rndvu_tagged_pois';

interface TagState {
  tags: TaggedPOI[];
  isLoaded: boolean;

  addTag: (tag: TaggedPOI) => void;
  confirmTag: (tagId: string) => void;
  loadTags: () => Promise<void>;
  clearTags: () => void;
}

export const useTagStore = create<TagState>((set, get) => ({
  tags: [],
  isLoaded: false,

  addTag: (tag) => {
    set((state) => {
      const exists = state.tags.some(t => t.id === tag.id);
      if (exists) return state;
      const tags = [...state.tags, tag];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tags)).catch(() => {});
      return { tags };
    });
  },

  confirmTag: (tagId) => {
    set((state) => {
      const tags = state.tags.map(t =>
        t.id === tagId ? { ...t, confirmCount: t.confirmCount + 1 } : t
      );
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tags)).catch(() => {});
      return { tags };
    });
  },

  loadTags: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const tags: TaggedPOI[] = JSON.parse(raw);
        set({ tags, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  clearTags: () => {
    set({ tags: [] });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
}));
