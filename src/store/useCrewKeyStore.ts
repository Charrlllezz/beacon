import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomBytes } from 'expo-crypto';
import { crewIdFor, toBase64Url, fromBase64Url, CREW_KEY_BYTES } from '../services/crew/invite';

// Model 2: which crew this phone is in. One crew per phone at a time. The key
// lives here (AsyncStorage) and on the radio, in plain storage on both; the
// radio side is the weaker one, so a keychain wouldn't add much
// (docs/design/model-2-crew-keys.md, Risks).

export type CrewSource = 'created' | 'invite' | 'radio';

export interface Crew {
  id: string;            // fingerprint of the key; what the Device sheet shows
  psk: Uint8Array;
  displayName: string;   // phone-side only, never on the radio
  createdAt: number;
  source: CrewSource;
}

const CREW_KEY = 'rndvu_crew';
const MODEL2_KEY = 'rndvu_model2';

export function newCrewKey(): Uint8Array {
  return getRandomBytes(CREW_KEY_BYTES);
}

export function makeCrew(psk: Uint8Array, source: CrewSource, displayName?: string): Crew {
  const id = crewIdFor(psk);
  return { id, psk, displayName: displayName?.trim() || `Crew ${id}`, createdAt: Date.now(), source };
}

interface Stored { psk: string; displayName: string; createdAt: number; source: CrewSource }

interface CrewKeyState {
  crew: Crew | null;
  // Per-crew keys are behind a switch (Device sheet) until the Beyond
  // Wonderland build; off, pairing writes the build's key as before.
  model2: boolean;
  loaded: boolean;
  setCrew: (crew: Crew | null) => void;
  setModel2: (on: boolean) => void;
  load: () => Promise<void>;
}

export const useCrewKeyStore = create<CrewKeyState>((set) => ({
  crew: null,
  model2: false,
  loaded: false,

  setCrew: (crew) => {
    set({ crew });
    const write = crew
      ? AsyncStorage.setItem(CREW_KEY, JSON.stringify({
          psk: toBase64Url(crew.psk), displayName: crew.displayName, createdAt: crew.createdAt, source: crew.source,
        } satisfies Stored))
      : AsyncStorage.removeItem(CREW_KEY);
    write.catch(() => {});
  },

  setModel2: (on) => {
    set({ model2: on });
    AsyncStorage.setItem(MODEL2_KEY, on ? '1' : '0').catch(() => {});
  },

  load: async () => {
    try {
      const [rawCrew, rawFlag] = await Promise.all([AsyncStorage.getItem(CREW_KEY), AsyncStorage.getItem(MODEL2_KEY)]);
      let crew: Crew | null = null;
      if (rawCrew) {
        const s = JSON.parse(rawCrew) as Stored;
        const psk = fromBase64Url(s.psk);
        if (psk && psk.length === CREW_KEY_BYTES) {
          crew = { id: crewIdFor(psk), psk, displayName: s.displayName, createdAt: s.createdAt, source: s.source };
        }
      }
      set({ crew, model2: rawFlag === '1', loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
