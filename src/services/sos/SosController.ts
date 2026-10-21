import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendCrewMessage } from '../mesh/send';
import { buildSOSMessage, buildReplyMessage } from '../mesh/MessageService';
import { useCrewStore } from '../../store/useCrewStore';
import { useDeviceStore } from '../../store/useDeviceStore';

// The sender's side of an SOS. Once started it repeats with a fresh location
// every 2 minutes until the sender taps "I'm OK" (decided: no auto-stop).
//
// iOS suspends JS timers while the phone is locked, so repeats run on a timer
// in the foreground and on every Bluetooth wake in the background (each crew
// packet wakes the app). With a locked phone and a quiet mesh, repeats come
// when the next packet arrives, not exactly every 2 minutes.

export const SOS_REPEAT_MS = 2 * 60 * 1000;
const STORAGE_KEY = 'rndvu_sos_active';

export interface ActiveSos {
  startedAt: number;
  rootPacketId: number | null;  // null until the first send reaches the radio
  lastSentAt: number | null;
  sends: number;
  // "I'm OK" tapped but not yet delivered to the radio (out of reach): keep
  // trying, so the crew isn't left thinking it's still on.
  ending?: boolean;
}

export type SosStep = 'none' | 'root' | 'repeat' | 'safe';

/** What the SOS should do now. */
export function sosDue(active: ActiveSos | null, nowMs: number, connected: boolean): SosStep {
  if (!active || !connected) return 'none';
  if (active.ending) return 'safe';
  if (active.rootPacketId === null) return 'root';
  if (active.lastSentAt === null || nowMs - active.lastSentAt >= SOS_REPEAT_MS) return 'repeat';
  return 'none';
}

interface SosState {
  active: ActiveSos | null;
  set: (active: ActiveSos | null) => void;
}

export const useSosStore = create<SosState>((set) => ({
  active: null,
  set: (active) => {
    set({ active });
    // Survives the app being killed in a pocket: the next launch carries on.
    (active ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(active)) : AsyncStorage.removeItem(STORAGE_KEY))
      .catch(() => {});
  },
}));

export async function loadActiveSos(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) useSosStore.setState({ active: JSON.parse(raw) as ActiveSos });
  } catch {}
}

// Other people's SOS threads (sosThread().key) whose banner this phone hid.
// Hiding also stops the repeat nudges. In memory only: after a relaunch an
// SOS that's still on shows again, the safer default.
export const hiddenSos = new Set<string>();

let inFlight = false;

function location(): { lat: number; lng: number } | null {
  const loc = useCrewStore.getState().myLocation;
  if (!loc || (loc.lat === 0 && loc.lng === 0)) return null;
  return loc;
}

/** Start an SOS. Resolves false only when there's no location to send. */
export async function startSos(): Promise<boolean> {
  if (!location()) return false;
  useSosStore.getState().set({ startedAt: Date.now(), rootPacketId: null, lastSentAt: null, sends: 0 });
  await tickSos();
  return true;
}

/**
 * Send whatever is due. Called on start, by a foreground timer, and on every
 * packet from the radio. Never runs two sends at once.
 */
export async function tickSos(nowMs = Date.now()): Promise<void> {
  const active = useSosStore.getState().active;
  const connected = useDeviceStore.getState().status === 'connected';
  const due = sosDue(active, nowMs, connected);
  if (due === 'none' || inFlight || !active) return;
  if (due === 'safe') {
    inFlight = true;
    try {
      const result = await sendCrewMessage(buildReplyMessage('safe'), { replyTo: active.rootPacketId! });
      if (result.ok && useSosStore.getState().active?.startedAt === active.startedAt) {
        useSosStore.getState().set(null);
      }
    } finally {
      inFlight = false;
    }
    return;
  }
  const loc = location();
  if (!loc) return;
  inFlight = true;
  try {
    const result = await sendCrewMessage(
      buildSOSMessage(loc.lat, loc.lng),
      due === 'repeat' ? { replyTo: active.rootPacketId! } : {},
    );
    const current = useSosStore.getState().active;
    const packetId = result.ok ? result.message.packetId ?? null : null;
    // Cancelled while the first alert was going out: the crew has it now, so
    // they need the "safe" too.
    if (!current && due === 'root' && packetId !== null) {
      useSosStore.getState().set({ ...active, rootPacketId: packetId, ending: true });
      setTimeout(() => { tickSos(); }, 0);
      return;
    }
    // Otherwise a cancel while sending stays cancelled.
    if (!result.ok || !current || current.startedAt !== active.startedAt || current.ending) return;
    useSosStore.getState().set({
      ...current,
      rootPacketId: due === 'root' ? packetId : current.rootPacketId,
      lastSentAt: nowMs,
      sends: current.sends + 1,
    });
  } finally {
    inFlight = false;
  }
}

/**
 * "I'm OK": stop repeating and tell the crew. If the first alert never left
 * the phone there's nothing to cancel. Otherwise "safe" keeps retrying until
 * it reaches the radio.
 */
export async function endSos(): Promise<void> {
  const active = useSosStore.getState().active;
  if (!active) return;
  if (active.rootPacketId === null) {
    useSosStore.getState().set(null);
    return;
  }
  useSosStore.getState().set({ ...active, ending: true });
  await tickSos();
}
