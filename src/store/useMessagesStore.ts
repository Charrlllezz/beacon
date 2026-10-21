import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message, SendStatus } from '../types/messages';

const STORAGE_KEY = 'rndvu_messages';
const MAX_MESSAGES = 500;
const PERSIST_DEBOUNCE_MS = 5000;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
// While backgrounded, iOS only gives us a few seconds per BLE wake before
// suspending again, and may kill a suspended app outright. A 5s debounce can
// outlive that window, so background arrivals are written straight away.
let persistImmediately = false;

export function setPersistImmediately(immediate: boolean): void {
  persistImmediately = immediate;
  if (immediate) flushPendingPersist();
}

function debouncedPersist(messages: Message[]) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (persistImmediately) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
}

interface MessagesState {
  messages: Message[];
  isLoaded: boolean;

  addMessage: (message: Message) => void;
  setSendStatus: (messageId: string, status: SendStatus) => void;
  loadMessages: () => Promise<void>;
  clearMessages: () => void;
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  messages: [],
  isLoaded: false,

  addMessage: (message) => {
    set((state) => {
      const existing = state.messages.find((m) => m.id === message.id);
      if (existing) return state;
      const messages = state.messages.length >= MAX_MESSAGES
        ? [...state.messages.slice(1), message]
        : [...state.messages, message];
      // Before the stored history has loaded, a write would replace it with
      // just these early arrivals. loadMessages merges and persists instead.
      if (state.isLoaded) debouncedPersist(messages);
      return { messages };
    });
  },

  setSendStatus: (messageId, status) => {
    set((state) => {
      let changed = false;
      const messages = state.messages.map(m => {
        if (m.id === messageId) {
          changed = true;
          return { ...m, sendStatus: status };
        }
        return m;
      });
      if (changed && state.isLoaded) debouncedPersist(messages);
      return { messages };
    });
  },

  loadMessages: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const stored: Message[] = raw ? JSON.parse(raw) : [];
      // Merge rather than replace: when iOS relaunches us in the background
      // for a BLE event, packets can be routed before this read resolves.
      const storedIds = new Set(stored.map(m => m.id));
      const arrivedEarly = get().messages.filter(m => !storedIds.has(m.id));
      const messages = [...stored, ...arrivedEarly].slice(-MAX_MESSAGES);
      set({ messages, isLoaded: true });
      if (arrivedEarly.length > 0) debouncedPersist(messages);
    } catch {
      set({ isLoaded: true });
    }
  },

  clearMessages: () => {
    // Cancel any pending debounced write first — otherwise a queued persist
    // holding the old (non-empty) array fires after removeItem and resurrects
    // the cleared messages on the next load.
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    set({ messages: [] });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
}));

// Flush the pending debounced write immediately. Call this from AppState
// 'background'/'inactive' so the last few seconds of messages survive a
// suspend or kill instead of being lost inside the 5s debounce window.
export function flushPendingPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!useMessagesStore.getState().isLoaded) return;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(useMessagesStore.getState().messages)).catch(() => {});
}
