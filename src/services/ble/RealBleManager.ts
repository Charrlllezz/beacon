import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import type { FromRadio } from '../../types/mesh';
import {
  MESHTASTIC_SERVICE_UUID,
  FROM_RADIO_UUID,
  TO_RADIO_UUID,
  FROM_NUM_UUID,
} from './ConnectionState';
import { decodeFromRadio, encodeToRadio, encodeWantConfig } from './MeshtasticCodec';
import { useDeviceStore } from '../../store/useDeviceStore';

export type PacketCallback = (fromRadio: FromRadio) => void;
export type StatusCallback = (status: 'connected' | 'disconnected') => void;

const CONFIG_ID = 42;

export class RealBleManager {
  private manager: BleManager;
  private device: Device | null = null;
  private packetCallback: PacketCallback | null = null;
  private statusCallback: StatusCallback | null = null;
  private notifySub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private isConnected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDeviceId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor() {
    this.manager = new BleManager();
  }

  onPacket(cb: PacketCallback): () => void {
    this.packetCallback = cb;
    return () => { if (this.packetCallback === cb) this.packetCallback = null; };
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusCallback = cb;
    return () => { if (this.statusCallback === cb) this.statusCallback = null; };
  }

  async scanAndConnect(): Promise<{ id: string; name: string }[]> {
    // Request permissions on Android
    if (Platform.OS === 'android') {
      await this.manager.enable();
    }

    return new Promise((resolve) => {
      const found: { id: string; name: string }[] = [];
      const seen = new Set<string>();

      this.manager.startDeviceScan(
        [MESHTASTIC_SERVICE_UUID],
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            console.warn('BLE scan error:', error);
            return;
          }
          if (device && !seen.has(device.id)) {
            seen.add(device.id);
            found.push({
              id: device.id,
              name: device.name ?? device.localName ?? `Meshtastic_${device.id.slice(-4)}`,
            });
          }
        },
      );

      // Stop scanning after 5 seconds
      setTimeout(() => {
        this.manager.stopDeviceScan();
        resolve(found);
      }, 5000);
    });
  }

  async connect(deviceId: string): Promise<void> {
    try {
      this.statusCallback?.('disconnected');

      // Connect to device
      const device = await this.manager.connectToDevice(deviceId, {
        requestMTU: 512,
        timeout: 10000,
      });

      // Discover services
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;

      // Listen for disconnects and auto-reconnect
      this.lastDeviceId = deviceId;
      this.reconnectAttempts = 0;
      this.disconnectSub = this.manager.onDeviceDisconnected(deviceId, () => {
        this.isConnected = false;
        this.statusCallback?.('disconnected');
        this.stopPolling();
        this.attemptReconnect();
      });

      // Subscribe to fromNum notifications (signals new data available)
      this.notifySub = device.monitorCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROM_NUM_UUID,
        () => {
          // New data available — read fromRadio
          this.readFromRadio();
        },
      );

      // Send wantConfig to kick off the config flow
      const wantConfigBytes = encodeWantConfig(CONFIG_ID);
      const base64 = this.uint8ToBase64(wantConfigBytes);
      await device.writeCharacteristicWithResponseForService(
        MESHTASTIC_SERVICE_UUID,
        TO_RADIO_UUID,
        base64,
      );

      this.isConnected = true;
      this.statusCallback?.('connected');

      // Start polling fromRadio to drain initial config
      await this.drainFromRadio();

      // Poll periodically for any missed notifications
      this.startPolling();

    } catch (error) {
      console.error('BLE connect error:', error);
      this.isConnected = false;
      this.statusCallback?.('disconnected');
      throw error;
    }
  }

  async sendText(text: string, channelIndex = 0): Promise<void> {
    if (!this.device || !this.isConnected) throw new Error('Not connected');

    const myNodeNum = useDeviceStore.getState().myNodeNum ?? 0;
    const toRadioBytes = encodeToRadio(0xffffffff, text, myNodeNum, channelIndex);
    const base64 = this.uint8ToBase64(toRadioBytes);

    await this.device.writeCharacteristicWithResponseForService(
      MESHTASTIC_SERVICE_UUID,
      TO_RADIO_UUID,
      base64,
    );
  }

  disconnect(): void {
    this.cancelReconnect();
    this.stopPolling();
    this.notifySub?.remove();
    this.disconnectSub?.remove();
    this.notifySub = null;
    this.disconnectSub = null;

    if (this.device) {
      this.manager.cancelDeviceConnection(this.device.id).catch(() => {});
      this.device = null;
    }

    this.isConnected = false;
    this.lastDeviceId = null;
    this.statusCallback?.('disconnected');
  }

  private attemptReconnect(): void {
    if (!this.lastDeviceId || this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts++;
    // Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

    this.reconnectTimer = setTimeout(async () => {
      if (this.isConnected || !this.lastDeviceId) return;
      try {
        await this.connect(this.lastDeviceId);
      } catch {
        this.attemptReconnect();
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private async readFromRadio(): Promise<boolean> {
    if (!this.device || !this.isConnected) return false;

    try {
      const char = await this.device.readCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROM_RADIO_UUID,
      );

      if (!char.value) return false;

      const bytes = this.base64ToUint8(char.value);
      if (bytes.length === 0) return false;

      const fromRadio = decodeFromRadio(bytes);
      this.packetCallback?.(fromRadio);
      return true;
    } catch (error) {
      console.warn('readFromRadio error:', error);
      return false;
    }
  }

  private async drainFromRadio(): Promise<void> {
    // Keep reading until we get an empty response, with a 3s timeout
    let hasMore = true;
    let reads = 0;
    const startTime = Date.now();
    while (hasMore && reads < 100 && Date.now() - startTime < 3000) {
      hasMore = await this.readFromRadio();
      reads++;
      if (hasMore) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.readFromRadio();
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToUint8(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export const realBleManager = new RealBleManager();
