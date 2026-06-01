import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message, SendStatus } from '../types/messages';

const STORAGE_KEY = 'rndvu_messages';
const MAX_MESSAGES = 500;
const PERSIST_DEBOUNCE_MS = 5000;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersist(messages: Message[]) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
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
      debouncedPersist(messages);
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
      if (changed) debouncedPersist(messages);
      return { messages };
    });
  },

  loadMessages: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const messages: Message[] = JSON.parse(raw);
        set({ messages, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  clearMessages: () => {
    set({ messages: [] });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
}));
