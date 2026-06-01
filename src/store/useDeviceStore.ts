import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MyNodeInfo, DeviceMetadata } from '../types/mesh';

const LAST_DEVICE_KEY = 'rndvu_last_device';

export type ConnectionStatus =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number;
}

interface DeviceState {
  status: ConnectionStatus;
  connectedDeviceId: string | null;
  connectedDeviceName: string | null;
  myNodeNum: number | null;
  myNodeInfo: MyNodeInfo | null;
  discoveredDevices: DiscoveredDevice[];
  firmwareVersion: string | null;
  hwModel: number | null;
  hasPKC: boolean | null;
  channelName: string;
  channelIndex: number | null;
  lastPacketAt: number | null;

  setStatus: (status: ConnectionStatus) => void;
  setConnectedDevice: (id: string, name: string) => void;
  setMyNodeInfo: (info: MyNodeInfo) => void;
  setMetadata: (meta: DeviceMetadata) => void;
  addDiscoveredDevice: (device: DiscoveredDevice) => void;
  clearDiscoveredDevices: () => void;
  setChannelName: (name: string) => void;
  setChannelIndex: (idx: number) => void;
  setLastPacketAt: (ts: number) => void;
  disconnect: () => void;
  saveLastDevice: () => void;
  loadLastDevice: () => Promise<{ id: string; name: string } | null>;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  status: 'disconnected',
  connectedDeviceId: null,
  connectedDeviceName: null,
  myNodeNum: null,
  myNodeInfo: null,
  discoveredDevices: [],
  firmwareVersion: null,
  hwModel: null,
  hasPKC: null,
  channelName: 'RNDVU',
  channelIndex: null,
  lastPacketAt: null,

  setStatus: (status) => set({ status }),
  setConnectedDevice: (id, name) =>
    set({ connectedDeviceId: id, connectedDeviceName: name }),
  setMyNodeInfo: (info) =>
    set({ myNodeInfo: info, myNodeNum: info.myNodeNum }),
  setMetadata: (meta) =>
    set({
      firmwareVersion: meta.firmwareVersion ?? null,
      hwModel: meta.hwModel ?? null,
      hasPKC: meta.hasPKC ?? null,
    }),
  addDiscoveredDevice: (device) =>
    set((state) => ({
      discoveredDevices: state.discoveredDevices.some((d) => d.id === device.id)
        ? state.discoveredDevices.map((d) => (d.id === device.id ? device : d))
        : [...state.discoveredDevices, device],
    })),
  clearDiscoveredDevices: () => set({ discoveredDevices: [] }),
  setChannelName: (channelName) => set({ channelName }),
  setChannelIndex: (channelIndex) => set({ channelIndex }),
  setLastPacketAt: (lastPacketAt) => set({ lastPacketAt }),
  disconnect: () =>
    set({
      status: 'disconnected',
      connectedDeviceId: null,
      connectedDeviceName: null,
      myNodeNum: null,
      myNodeInfo: null,
    }),

  saveLastDevice: () => {
    const { connectedDeviceId, connectedDeviceName } = useDeviceStore.getState();
    if (connectedDeviceId && connectedDeviceName) {
      AsyncStorage.setItem(LAST_DEVICE_KEY, JSON.stringify({
        id: connectedDeviceId,
        name: connectedDeviceName,
      }));
    }
  },

  loadLastDevice: async () => {
    try {
      const raw = await AsyncStorage.getItem(LAST_DEVICE_KEY);
      if (raw) return JSON.parse(raw) as { id: string; name: string };
    } catch {}
    return null;
  },
}));

/**
 * Resolve once myNodeNum is populated from the device's config drain, or null
 * if the timeout elapses first. Replaces hardcoded setTimeout guesses around
 * setOwner so we wait exactly as long as the device needs.
 */
export function waitForMyNode(timeoutMs = 10000): Promise<number | null> {
  return new Promise((resolve) => {
    const existing = useDeviceStore.getState().myNodeNum;
    if (existing !== null && existing !== 0) {
      resolve(existing);
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unsub = useDeviceStore.subscribe((state) => {
      if (state.myNodeNum !== null && state.myNodeNum !== 0) {
        unsub();
        if (timeout) clearTimeout(timeout);
        resolve(state.myNodeNum);
      }
    });
    timeout = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
  });
}
