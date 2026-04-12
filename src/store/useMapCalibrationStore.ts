import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GpsPoint } from '../types/festival';

const STORAGE_KEY = 'rndvu_map_calibration';

interface MapCalibrationAnchors {
  topLeft: GpsPoint;
  bottomRight: GpsPoint;
}

interface MapCalibrationStore {
  anchors: MapCalibrationAnchors | null;
  isLoaded: boolean;

  setAnchors: (anchors: MapCalibrationAnchors) => void;
  clearAnchors: () => void;
  loadAnchors: () => Promise<void>;
}

export const useMapCalibrationStore = create<MapCalibrationStore>((set) => ({
  anchors: null,
  isLoaded: false,

  setAnchors: (anchors) => {
    set({ anchors });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(anchors)).catch(() => {});
  },

  clearAnchors: () => {
    set({ anchors: null });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },

  loadAnchors: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const anchors: MapCalibrationAnchors = JSON.parse(raw);
        set({ anchors, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },
}));
