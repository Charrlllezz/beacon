import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message } from '../types/messages';

// In-memory AsyncStorage with a controllable getItem, so tests can hold the
// initial history read open while packets arrive (background relaunch).
const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  let gate: Promise<void> | null = null;
  return {
    data,
    holdReads() {
      let release!: () => void;
      gate = new Promise(r => { release = r; });
      return () => { gate = null; release(); };
    },
    api: {
      getItem: async (k: string) => { if (gate) await gate; return data.get(k) ?? null; },
      setItem: async (k: string, v: string) => { data.set(k, v); },
      removeItem: async (k: string) => { data.delete(k); },
    },
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage.api }));

import { useMessagesStore, setPersistImmediately, flushPendingPersist } from './useMessagesStore';

const KEY = 'rndvu_messages';
const msg = (id: string, text = id): Message =>
  ({ id, type: 'text', text, fromNodeId: 1, fromName: 'Maya', timestamp: 0, channelIndex: 0 });
const storedIds = () => (JSON.parse(storage.data.get(KEY) ?? '[]') as Message[]).map(m => m.id);

describe('useMessagesStore persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storage.data.clear();
    setPersistImmediately(false);
    useMessagesStore.setState({ messages: [], isLoaded: false });
  });
  afterEach(() => { vi.useRealTimers(); });

  test('messages routed before history loads are merged, and history is not overwritten', async () => {
    storage.data.set(KEY, JSON.stringify([msg('old-1'), msg('old-2')]));
    setPersistImmediately(true); // background relaunch
    const release = storage.holdReads();
    const loading = useMessagesStore.getState().loadMessages();

    useMessagesStore.getState().addMessage(msg('early'));
    await vi.advanceTimersByTimeAsync(0);
    // Not written yet: a write now would replace history with just 'early'.
    expect(storedIds()).toEqual(['old-1', 'old-2']);

    release();
    await loading;
    await vi.advanceTimersByTimeAsync(0);
    expect(useMessagesStore.getState().messages.map(m => m.id)).toEqual(['old-1', 'old-2', 'early']);
    expect(storedIds()).toEqual(['old-1', 'old-2', 'early']);
  });

  test('backgrounded: each arrival is written immediately (no 5s debounce)', async () => {
    await useMessagesStore.getState().loadMessages();
    setPersistImmediately(true);
    useMessagesStore.getState().addMessage(msg('bg-1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(storedIds()).toEqual(['bg-1']);
  });

  test('foreground: writes stay debounced', async () => {
    await useMessagesStore.getState().loadMessages();
    useMessagesStore.getState().addMessage(msg('fg-1'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.data.has(KEY)).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(storedIds()).toEqual(['fg-1']);
  });

  test('drops Beacon-era calibration entries persisted by older builds', async () => {
    const legacy = { id: 'cal', type: 'calibration', anchors: {}, fromNodeId: 1, fromName: 'x', timestamp: 0, channelIndex: 0 };
    storage.data.set(KEY, JSON.stringify([msg('keep'), legacy]));
    await useMessagesStore.getState().loadMessages();
    expect(useMessagesStore.getState().messages.map(m => m.id)).toEqual(['keep']);
  });

  test('flush before history has loaded is a no-op', async () => {
    storage.data.set(KEY, JSON.stringify([msg('old')]));
    useMessagesStore.getState().addMessage(msg('early'));
    flushPendingPersist();
    await vi.advanceTimersByTimeAsync(0);
    expect(storedIds()).toEqual(['old']);
  });
});
