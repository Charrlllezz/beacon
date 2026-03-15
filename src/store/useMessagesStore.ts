import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message } from '../types/messages';

const STORAGE_KEY = 'beacon_messages';
const MAX_MESSAGES = 500;

interface MessagesState {
  messages: Message[];
  isLoaded: boolean;

  addMessage: (message: Message) => void;
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
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
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
