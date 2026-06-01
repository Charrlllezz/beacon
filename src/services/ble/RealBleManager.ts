import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import type { FromRadio } from '../../types/mesh';
import {
  MESHTASTIC_SERVICE_UUID,
  FROM_RADIO_UUID,
  TO_RADIO_UUID,
  FROM_NUM_UUID,
} from './ConnectionState';
import { decodeFromRadio, encodeToRadio, encodeWantConfig, encodeSetChannel, encodeBeginEditSettings, encodeCommitEditSettings, encodeDisableChannel, encodeSetLoraConfig, encodeReboot, encodeHeartbeat, encodeSetOwner, encodeFactoryReset, encodeSetPositionConfig } from './MeshtasticCodec';
import { useDeviceStore } from '../../store/useDeviceStore';

export type PacketCallback = (fromRadio: FromRadio) => void;
export type StatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

const CONFIG_ID = 42;

export class RealBleManager {
  private manager: BleManager;
  private device: Device | null = null;
  private packetCallbacks = new Set<PacketCallback>();
  private statusCallbacks = new Set<StatusCallback>();
  private notifySub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private isConnected = false;
  private isConnecting = false;
  private configDrainComplete = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDeviceId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor() {
    this.manager = new BleManager();
  }

  onPacket(cb: PacketCallback): () => void {
    this.packetCallbacks.add(cb);
    return () => { this.packetCallbacks.delete(cb); };
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusCallbacks.add(cb);
    return () => { this.statusCallbacks.delete(cb); };
  }

  private emitPacket(fromRadio: FromRadio): void {
    this.packetCallbacks.forEach(cb => cb(fromRadio));
  }

  private emitStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
    this.statusCallbacks.forEach(cb => cb(status));
  }

  async scanAndConnect(): Promise<{ id: string; name: string }[]> {
    // Request permissions on Android
    if (Platform.OS === 'android') {
      await this.manager.enable();
    }

    return new Promise((resolve) => {
      const found: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        this.manager.stopDeviceScan();
        resolve(found);
      };

      // Scan ALL devices (no UUID filter) and match on name. Some Meshtastic
      // firmware puts the service UUID only in the scan response, which iOS
      // can miss on 5-second filtered scans. Name-based filtering is more
      // reliable across firmware variants.
      this.manager.startDeviceScan(
        null,
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            // Permission denied, BLE off, or platform error — resolve early
            // instead of burning the full 8s timer.
            console.warn('BLE scan error:', error.message);
            finish();
            return;
          }
          if (!device || seen.has(device.id)) return;

          const name = device.name ?? device.localName ?? '';
          const isMeshtastic =
            name.toLowerCase().startsWith('meshtastic') ||
            name.toLowerCase().startsWith('mshtst') ||
            (device.serviceUUIDs?.some(u => u.toLowerCase() === MESHTASTIC_SERVICE_UUID) ?? false);

          if (!isMeshtastic) return;

          seen.add(device.id);
          found.push({
            id: device.id,
            name: name || `Meshtastic_${device.id.slice(-4)}`,
          });
        },
      );

      // Stop scanning after 8 seconds (was 5s — longer window catches
      // devices that advertise intermittently or had late boots)
      setTimeout(finish, 8000);
    });
  }

  async connect(deviceId: string): Promise<void> {
    // Guard against overlapping connect calls. A manual Reconnect tap during
    // an auto-retry used to tangle two in-flight connects.
    if (this.isConnecting) {
      console.warn('connect() already in flight — ignoring duplicate call');
      return;
    }
    this.isConnecting = true;
    try {
      // Connect to device. No MTU negotiation anywhere — bundled requestMTU
      // caused 1-second connect failures on iPhone 13 (older BLE stack),
      // and even post-connect requestMTU caused GATT session teardown ~2
      // seconds in. Meshtastic works fine on default MTU (23 bytes) since
      // our writes are all <200 bytes and BLE fragments transparently.
      const device = await this.manager.connectToDevice(deviceId, {
        timeout: 20000,
      });

      // Discover services
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;

      // Remove any leftover subscriptions from a prior connect cycle before
      // registering new ones — otherwise orphan handlers accumulate and each
      // real disconnect fires multiple racing reconnect attempts.
      this.notifySub?.remove();
      this.disconnectSub?.remove();
      this.notifySub = null;
      this.disconnectSub = null;

      // Listen for disconnects and auto-reconnect
      this.lastDeviceId = deviceId;
      this.reconnectAttempts = 0;
      this.disconnectSub = this.manager.onDeviceDisconnected(deviceId, () => {
        this.isConnected = false;
        this.stopPolling();
        this.stopHeartbeat();
        // Emit 'reconnecting' (not 'disconnected') so the UI shows the retry
        // loop is active. Only flip to 'disconnected' once attempts exhaust.
        if (this.lastDeviceId && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.emitStatus('reconnecting');
          this.attemptReconnect();
        } else {
          this.emitStatus('disconnected');
        }
      });

      // Subscribe to fromNum notifications (signals new data available).
      // Surface errors — a wrong UUID or unsupported characteristic used to
      // fail silently because this callback ignored the error arg, which
      // made packets arrive only via the 5s backup poll.
      this.notifySub = device.monitorCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROM_NUM_UUID,
        (error, _char) => {
          if (error) {
            console.warn('FROM_NUM monitor error:', error.message);
            return;
          }
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
      this.emitStatus('connected');

      // Start polling fromRadio to drain initial config
      await this.drainFromRadio();

      // Poll periodically for any missed notifications
      this.startPolling();

      // Start heartbeat to keep firmware from timing out the phone BLE link
      this.startHeartbeat();

      this.isConnecting = false;
    } catch (error) {
      console.error('BLE connect error:', error);
      this.isConnected = false;
      this.isConnecting = false;
      this.emitStatus('disconnected');
      throw error;
    }
  }

  private async writeAdmin(bytes: Uint8Array): Promise<void> {
    await this.device!.writeCharacteristicWithResponseForService(
      MESHTASTIC_SERVICE_UUID,
      TO_RADIO_UUID,
      this.uint8ToBase64(bytes),
    );
    await new Promise(r => setTimeout(r, 300));
  }

  /**
   * Full device configuration: sets the RNDVU channel, disables stale channels,
   * and enforces LoRa region/modem so every device ends up in the same state
   * regardless of prior configuration.
   */
  async setChannel(channelIndex: number, channelName: string, psk: Uint8Array, role = 1): Promise<void> {
    if (!this.device || !this.isConnected) throw new Error('Not connected');

    const myNodeNum = useDeviceStore.getState().myNodeNum ?? 0;
    if (myNodeNum === 0) throw new Error('Node number not yet available');

    // 1. Begin edit transaction
    await this.writeAdmin(encodeBeginEditSettings(myNodeNum));

    // 2. Set channel 0 as RNDVU PRIMARY
    await this.writeAdmin(encodeSetChannel(myNodeNum, channelIndex, channelName, psk, role));

    // 3. Disable channels 1-7 to clear any prior config
    for (let i = 1; i <= 7; i++) {
      await this.writeAdmin(encodeDisableChannel(myNodeNum, i));
    }

    // 4. Set LoRa region to US to ensure radio compatibility
    await this.writeAdmin(encodeSetLoraConfig(myNodeNum, 1)); // RegionCode.US = 1

    // 5. Commit edit transaction (persists to flash)
    await this.writeAdmin(encodeCommitEditSettings(myNodeNum));

    // 6. Reboot device so config changes take effect
    //    Device will disconnect and auto-reconnect picks it back up
    await this.writeAdmin(encodeReboot(myNodeNum, 2));
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

  /**
   * Writes the user's display name to the T-Echo so NodeInfo broadcasts
   * carry the RNDVU name, not the factory default. Without this, peers see
   * this node as "Unknown" in their Crew tab.
   */
  async setOwner(longName: string, shortName: string): Promise<void> {
    if (!this.device || !this.isConnected) throw new Error('Not connected');

    const myNodeNum = useDeviceStore.getState().myNodeNum ?? 0;
    if (myNodeNum === 0) throw new Error('Node number not yet available');

    const bytes = encodeSetOwner(myNodeNum, longName, shortName);
    await this.device.writeCharacteristicWithResponseForService(
      MESHTASTIC_SERVICE_UUID,
      TO_RADIO_UUID,
      this.uint8ToBase64(bytes),
    );
  }

  /**
   * Factory-reset the T-Echo. Wipes all config + nodeDB + keypair. Device
   * reboots; our auto-reconnect picks it back up, then the caller should
   * re-run the provisioning path (setChannel + setOwner) to rehydrate.
   */
  async factoryReset(): Promise<void> {
    if (!this.device || !this.isConnected) throw new Error('Not connected');
    const myNodeNum = useDeviceStore.getState().myNodeNum ?? 0;
    if (myNodeNum === 0) throw new Error('Node number not yet available');
    await this.writeAdmin(encodeFactoryReset(myNodeNum));
  }

  /**
   * Toggle the T-Echo's autonomous position broadcasts for privacy. When
   * disabled, firmware stops sending POSITION_APP packets to the mesh, so
   * peers no longer see the user on the map. Phone-side myLocation (GPS via
   * expo-location) is unaffected.
   *
   * UNTESTED on real hardware. The PositionConfig write pattern mirrors the
   * LoRaConfig fix — all fields explicit to avoid proto3-default clobbering.
   * Verify on a single device before wiring to UI.
   */
  async setLocationSharing(enabled: boolean): Promise<void> {
    if (!this.device || !this.isConnected) throw new Error('Not connected');
    const myNodeNum = useDeviceStore.getState().myNodeNum ?? 0;
    if (myNodeNum === 0) throw new Error('Node number not yet available');
    // When sharing: 900s (15 min) broadcasts + GPS enabled.
    // When off: GPS hardware disabled entirely; firmware stops position
    // broadcasts because there's nothing to report.
    const broadcastSecs = enabled ? 900 : 0;
    const gpsMode = enabled ? 1 /* ENABLED */ : 0 /* DISABLED */;
    await this.writeAdmin(encodeSetPositionConfig(myNodeNum, broadcastSecs, gpsMode));
  }

  disconnect(): void {
    this.cancelReconnect();
    this.stopPolling();
    this.stopHeartbeat();
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
    this.emitStatus('disconnected');
  }

  private attemptReconnect(): void {
    if (!this.lastDeviceId || this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emitStatus('disconnected');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, capped at 15s. Faster first
    // retry so transient RF drops recover quickly.
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts - 1), 15000);

    this.reconnectTimer = setTimeout(async () => {
      // Bail if we're already connected, have no target, or a manual
      // connect() is already in flight (e.g., user tapped Reconnect).
      if (this.isConnected || !this.lastDeviceId || this.isConnecting) return;
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
      // Firmware signals end-of-config-drain via configCompleteId. Capture it
      // here before emitting so drainFromRadio can stop precisely.
      if (fromRadio.configCompleteId !== undefined) {
        this.configDrainComplete = true;
      }
      this.emitPacket(fromRadio);
      return true;
    } catch (error) {
      console.warn('readFromRadio error:', error);
      return false;
    }
  }

  private async drainFromRadio(): Promise<void> {
    // Drain until firmware sends configCompleteId (the canonical end signal).
    // 10s hard cap as a safety net for stuck firmware. 200ms pacing between
    // reads avoids hammering older iOS BLE stacks (iPhone 13-era) which can
    // tear down the GATT session under load.
    this.configDrainComplete = false;
    const startTime = Date.now();
    const TIMEOUT_MS = 10000;
    const PACE_MS = 200;
    while (!this.configDrainComplete && Date.now() - startTime < TIMEOUT_MS) {
      const hasMore = await this.readFromRadio();
      if (!hasMore && !this.configDrainComplete) {
        // Empty read before configComplete — firmware is still preparing the
        // next batch. Back off briefly and try again.
        await new Promise(r => setTimeout(r, PACE_MS));
      } else if (hasMore) {
        await new Promise(r => setTimeout(r, PACE_MS));
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

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Write a heartbeat every 60s so the firmware's phone_timeout_secs
    // (default ~15 minutes) doesn't drop the BLE link when the app is idle.
    this.heartbeatTimer = setInterval(async () => {
      if (!this.device || !this.isConnected) return;
      try {
        const bytes = encodeHeartbeat();
        await this.device.writeCharacteristicWithResponseForService(
          MESHTASTIC_SERVICE_UUID,
          TO_RADIO_UUID,
          this.uint8ToBase64(bytes),
        );
      } catch (e) {
        console.warn('Heartbeat write failed:', e);
      }
    }, 60000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
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
