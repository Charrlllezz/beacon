import { create } from 'zustand';
import type { MyNodeInfo } from '../types/mesh';

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
  channelName: string;

  setStatus: (status: ConnectionStatus) => void;
  setConnectedDevice: (id: string, name: string) => void;
  setMyNodeInfo: (info: MyNodeInfo) => void;
  addDiscoveredDevice: (device: DiscoveredDevice) => void;
  clearDiscoveredDevices: () => void;
  setChannelName: (name: string) => void;
  disconnect: () => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  status: 'disconnected',
  connectedDeviceId: null,
  connectedDeviceName: null,
  myNodeNum: null,
  myNodeInfo: null,
  discoveredDevices: [],
  firmwareVersion: null,
  channelName: 'Beacon',

  setStatus: (status) => set({ status }),
  setConnectedDevice: (id, name) =>
    set({ connectedDeviceId: id, connectedDeviceName: name }),
  setMyNodeInfo: (info) =>
    set({ myNodeInfo: info, myNodeNum: info.myNodeNum }),
  addDiscoveredDevice: (device) =>
    set((state) => ({
      discoveredDevices: state.discoveredDevices.some((d) => d.id === device.id)
        ? state.discoveredDevices.map((d) => (d.id === device.id ? device : d))
        : [...state.discoveredDevices, device],
    })),
  clearDiscoveredDevices: () => set({ discoveredDevices: [] }),
  setChannelName: (channelName) => set({ channelName }),
  disconnect: () =>
    set({
      status: 'disconnected',
      connectedDeviceId: null,
      connectedDeviceName: null,
      myNodeNum: null,
      myNodeInfo: null,
    }),
}));
