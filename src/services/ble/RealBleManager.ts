import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import type { FromRadio } from '../../types/mesh';
import {
  MESHTASTIC_SERVICE_UUID,
  FROM_RADIO_UUID,
  TO_RADIO_UUID,
  FROM_NUM_UUID,
} from './ConnectionState';
import { decodeFromRadio, encodeToRadio, encodeWantConfig, encodeSetChannel, encodeBeginEditSettings, encodeCommitEditSettings, encodeDisableChannel, encodeSetLoraConfig, encodeHeartbeat, encodeSetOwner, encodeFactoryReset, encodeSetPositionConfig } from './MeshtasticCodec';
import { useDeviceStore } from '../../store/useDeviceStore';

export type PacketCallback = (fromRadio: FromRadio) => void;
export type StatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

const CONFIG_ID = 42;
const CONNECT_TIMEOUT_MS = 20000;
const PENDING_CONNECT_RETRY_MS = 15000;
// CoreBluetooth state-restoration key. Lets iOS relaunch RNDVU in the
// background for a BLE event (radio sent a packet, pending connect completed)
// after the system killed the suspended app. Ignored on Android.
const RESTORE_STATE_ID = 'rndvu-ble-central';

export interface ConnectOptions {
  /**
   * Keep trying after this attempt fails: fast backoff while foregrounded,
   * then a pending connect that iOS completes whenever the radio is back.
   * For "this is my radio, stay with it" callers (cold launch, foreground,
   * Reconnect). Onboarding leaves it off so a failed pick doesn't connect
   * behind the user's back.
   */
  autoRetry?: boolean;
}

/**
 * Thrown by writeAdmin when the BLE link drops partway through a provisioning
 * sequence (setChannel etc.). Callers should treat it as "retry the whole
 * transaction" rather than assuming a partial config landed.
 */
export class ProvisioningInterruptedError extends Error {
  constructor() {
    super('BLE connection lost during provisioning');
    this.name = 'ProvisioningInterruptedError';
  }
}

export class RealBleManager {
  private manager: BleManager;
  private device: Device | null = null;
  private packetCallbacks = new Set<PacketCallback>();
  private statusCallbacks = new Set<StatusCallback>();
  private notifySub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private isConnected = false;
  private isConnecting = false;
  private isReading = false;
  private aborted = false;
  private configDrainComplete = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDeviceId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  // Bumped by every connect attempt and by disconnect(). A connect whose
  // generation is stale was superseded (Release, Reconnect tap, cancelled
  // pending connect) and must not touch shared state when it settles.
  private connectGen = 0;
  // Device id of a connectToDevice that hasn't resolved yet, so disconnect()
  // can cancel it. Matters for no-timeout pending connects, which otherwise
  // stay queued in CoreBluetooth indefinitely.
  private pendingConnectId: string | null = null;
  private appActive = true;
  private draining = false;
  private drainAgain = false;

  constructor() {
    this.manager = new BleManager({
      restoreStateIdentifier: RESTORE_STATE_ID,
      restoreStateFunction: (restored) => {
        // Nothing to rebuild here: App.tsx runs its normal cold-launch
        // reconnect, and connect() adopts a peripheral iOS already holds
        // connected instead of dialing it again (see acquireDevice).
        const n = restored?.connectedPeripherals?.length ?? 0;
        if (n > 0) console.log(`BLE state restored with ${n} connected peripheral(s)`);
      },
    });
  }

  /**
   * App foreground/background signal from App.tsx. Timers don't run while iOS
   * has us suspended, so in the background a lost link is handed straight to
   * a no-timeout pending connect (iOS completes it and wakes us) instead of
   * the timer-driven backoff.
   */
  setAppActive(active: boolean): void {
    this.appActive = active;
    if (!active && this.reconnectTimer && !this.isConnected) {
      // A backoff retry is queued on a JS timer that won't fire while
      // suspended. Swap it for a pending connect.
      this.clearReconnectTimer();
      this.runReconnect(null);
    }
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

  async connect(deviceId: string, opts: ConnectOptions = {}): Promise<void> {
    if (opts.autoRetry) this.lastDeviceId = deviceId;
    try {
      await this.openSession(deviceId, CONNECT_TIMEOUT_MS);
    } catch (error) {
      // Still wanted (not released meanwhile): keep trying in the background.
      if (opts.autoRetry && this.lastDeviceId === deviceId) this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * timeoutMs null = a CoreBluetooth pending connect: never times out, survives
   * the app being suspended, and completes (waking us) when the radio comes
   * back into range or finishes rebooting.
   */
  private async openSession(deviceId: string, timeoutMs: number | null): Promise<void> {
    // Guard against overlapping connect calls. A manual Reconnect tap during
    // an auto-retry used to tangle two in-flight connects.
    if (this.isConnecting) {
      console.warn('connect() already in flight — ignoring duplicate call');
      return;
    }
    this.isConnecting = true;
    this.aborted = false;
    const gen = ++this.connectGen;
    try {
      await this.waitForPoweredOn();
      // Connect to device. No MTU negotiation anywhere — bundled requestMTU
      // caused 1-second connect failures on iPhone 13 (older BLE stack),
      // and even post-connect requestMTU caused GATT session teardown ~2
      // seconds in. Meshtastic works fine on default MTU (23 bytes) since
      // our writes are all <200 bytes and BLE fragments transparently.
      this.pendingConnectId = deviceId;
      const device = await this.acquireDevice(deviceId, timeoutMs);
      if (gen === this.connectGen) this.pendingConnectId = null;

      // If disconnect() fired while connectToDevice was in flight, abandon
      // this connection instead of re-acquiring the single BLE slot (the
      // T-Echo holds only one central; the user wanted it released).
      if (this.aborted || gen !== this.connectGen) {
        // ...unless a newer connect already owns this radio: cancelling by
        // device id would tear down its link too.
        const newerSessionOwnsIt = this.isConnecting || this.isConnected;
        if (!newerSessionOwnsIt) this.manager.cancelDeviceConnection(deviceId).catch(() => {});
        if (gen === this.connectGen) this.isConnecting = false;
        return;
      }

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
        this.scheduleReconnect();
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
          this.drainPending();
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

      // If the link dropped during the (up-to-10s) drain, don't start timers or
      // hold a 'connected' claim — let the reconnect path take over cleanly.
      if (!this.isConnected || this.aborted || gen !== this.connectGen) {
        if (gen === this.connectGen) this.isConnecting = false;
        return;
      }

      // Poll periodically for any missed notifications
      this.startPolling();

      // Start heartbeat to keep firmware from timing out the phone BLE link
      this.startHeartbeat();

      this.isConnecting = false;
    } catch (error) {
      // Superseded (e.g. disconnect() cancelled this pending connect, and a
      // newer connect may already own the flags). Stay quiet.
      if (gen !== this.connectGen) return;
      this.pendingConnectId = null;
      console.error('BLE connect error:', error);
      this.isConnected = false;
      this.isConnecting = false;
      this.emitStatus('disconnected');
      throw error;
    }
  }

  /**
   * Reuse a link iOS already holds (state restoration relaunch, or a JS reload
   * while the native side stayed connected) rather than dialing again, which
   * ble-plx rejects as "already connected".
   */
  private async acquireDevice(deviceId: string, timeoutMs: number | null): Promise<Device> {
    try {
      if (await this.manager.isDeviceConnected(deviceId)) {
        const [known] = await this.manager.devices([deviceId]);
        if (known) return known;
      }
    } catch {
      // Unknown id or adapter not ready; fall through to a normal connect.
    }
    return this.manager.connectToDevice(
      deviceId,
      timeoutMs === null ? undefined : { timeout: timeoutMs },
    );
  }

  /**
   * On a background relaunch the adapter can still be in Unknown/Resetting
   * when JS starts; connecting then fails outright. Wait briefly for PoweredOn.
   */
  private waitForPoweredOn(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      let sub: Subscription | null = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub?.remove();
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      sub = this.manager.onStateChange((state) => {
        if (state === State.PoweredOn) finish();
      }, true);
      if (done) sub.remove();
    });
  }

  private async writeAdmin(bytes: Uint8Array): Promise<void> {
    // Provisioning is a multi-write sequence; if the link drops partway the
    // remaining writes used to hit a stale `this.device!` and reject opaquely.
    // Fail fast with a typed error so callers can retry the WHOLE transaction
    // (and reprovision keeps NEEDS_REPROVISION set until it fully lands).
    if (!this.device || !this.isConnected) {
      throw new ProvisioningInterruptedError();
    }
    await this.device.writeCharacteristicWithResponseForService(
      MESHTASTIC_SERVICE_UUID,
      TO_RADIO_UUID,
      this.uint8ToBase64(bytes),
    );
    await new Promise(r => setTimeout(r, 300));
  }

  /**
   * Full device configuration: LoRa region/modem, the RNDVU channel, stale
   * channels disabled, and (when given) the owner name, so every device ends up
   * in the same state regardless of prior configuration.
   *
   * One edit transaction, one commit, one reboot. The commit has to be the
   * last write: firmware (since at least 2.5) shuts Bluetooth off the moment it
   * handles commit_edit_settings (AdminModule → disableBluetooth, which on the
   * T-Echo's nRF52 disconnects the phone), then reboots 7 s later
   * (DEFAULT_REBOOT_SECONDS). The old sequence committed region first, so on a
   * T-Echo the channel writes after it hit a dead link, and the retry did the
   * same. Inside the transaction nothing is saved and nothing drops the link,
   * so an interruption commits nothing and the caller retries the whole thing
   * (ProvisioningInterruptedError). The owner goes in here too: on its own,
   * set_owner reboots the radio separately.
   */
  async setChannel(
    channelIndex: number,
    channelName: string,
    psk: Uint8Array,
    role = 1,
    owner?: { longName: string; shortName: string },
  ): Promise<void> {
    if (!this.device || !this.isConnected) throw new Error('Not connected');

    const myNodeNum = useDeviceStore.getState().myNodeNum ?? 0;
    if (myNodeNum === 0) throw new Error('Node number not yet available');

    await this.writeAdmin(encodeBeginEditSettings(myNodeNum));
    await this.writeAdmin(encodeSetLoraConfig(myNodeNum, 1)); // RegionCode.US = 1
    await this.writeAdmin(encodeSetChannel(myNodeNum, channelIndex, channelName, psk, role));
    for (let i = 1; i <= 7; i++) {
      await this.writeAdmin(encodeDisableChannel(myNodeNum, i));
    }
    if (owner) await this.writeAdmin(encodeSetOwner(myNodeNum, owner.longName, owner.shortName));
    // Saves everything, drops Bluetooth and reboots; auto-reconnect restores the link.
    await this.writeAdmin(encodeCommitEditSettings(myNodeNum));
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
   *
   * On its own this reboots the radio (~7 s later, firmware saveChanges), so
   * pairing passes the name to setChannel instead. Use this only for a rename.
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
    // Abort any in-flight connect() so a connectToDevice that resolves after
    // this call doesn't silently re-acquire the single BLE slot, and clear
    // isConnecting so a pending reconnect attempt isn't blocked.
    this.aborted = true;
    this.isConnecting = false;
    this.connectGen++;
    this.cancelReconnect();
    // A pending (no-timeout) connect lives in CoreBluetooth until cancelled;
    // left alone it would grab the radio back after the user released it.
    if (this.pendingConnectId) {
      this.manager.cancelDeviceConnection(this.pendingConnectId).catch(() => {});
      this.pendingConnectId = null;
    }
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

  /**
   * Single entry point after the link is lost or a retry fails. Foreground:
   * exponential backoff with timed connects, as before. Background, or once
   * the fast retries are spent: one no-timeout pending connect, which iOS keeps
   * alive while we're suspended and completes when the radio is reachable.
   * The old behaviour (give up after ten tries) left a locked phone off the
   * mesh until someone opened the app.
   */
  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    if (!this.lastDeviceId) {
      this.emitStatus('disconnected');
      return;
    }

    if (!this.appActive || this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Foreground with retries spent: be honest in the UI ('disconnected'),
      // but keep waiting for the radio underneath.
      this.emitStatus(this.appActive ? 'disconnected' : 'reconnecting');
      this.runReconnect(null);
      return;
    }

    // Emit 'reconnecting' (not 'disconnected') so the UI shows the retry
    // loop is active.
    this.emitStatus('reconnecting');
    this.reconnectAttempts++;
    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, capped at 15s. Faster first
    // retry so transient RF drops recover quickly.
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts - 1), 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.runReconnect(CONNECT_TIMEOUT_MS);
    }, delay);
  }

  private async runReconnect(timeoutMs: number | null): Promise<void> {
    if (this.isConnected || !this.lastDeviceId) return;
    // A connect() is still in flight (e.g. mid config-drain). Re-arm shortly
    // instead of silently giving up — otherwise a disconnect during connect
    // wedges the UI on 'reconnecting'.
    if (this.isConnecting) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.scheduleReconnect();
      }, 1000);
      return;
    }
    const deviceId = this.lastDeviceId;
    try {
      await this.openSession(deviceId, timeoutMs);
    } catch {
      // Released or re-targeted while we were trying: stop here.
      if (this.lastDeviceId !== deviceId) return;
      if (timeoutMs === null) {
        // A pending connect only fails fast for a reason that won't clear on
        // its own right away (Bluetooth off, unknown peripheral). Don't spin.
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.scheduleReconnect();
        }, PENDING_CONNECT_RETRY_MS);
        return;
      }
      this.scheduleReconnect();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cancelReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
  }

  private async readFromRadio(): Promise<boolean> {
    if (!this.device || !this.isConnected) return false;
    // Serialize reads: the FROM_NUM notify, the 5s poll, and drainFromRadio can
    // all call this concurrently, and each FROM_RADIO read destructively pops
    // one frame from the firmware FIFO. A skipped concurrent read is harmless —
    // the in-flight read drains that frame and the next poll/notify continues.
    if (this.isReading) return false;
    this.isReading = true;

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
    } finally {
      this.isReading = false;
    }
  }

  /**
   * Drain ALL currently-queued FROM_RADIO frames, not just one. Run on each
   * FROM_NUM notification (and the backup poll) so a burst of messages arrives
   * right away instead of trickling out one-per-5s-poll. Each readFromRadio is a
   * BLE round-trip (naturally paced), capped so a misbehaving radio can't spin.
   * The isReading guard keeps overlapping drains from double-reading a frame.
   *
   * A notify that lands while a drain is already running sets drainAgain
   * rather than being dropped: the running drain may have just read "empty"
   * before that frame was queued. In the foreground the 5s poll used to paper
   * over this; in the background the poll timer doesn't run, so the frame
   * would sit until the next packet happened to wake us.
   */
  private async drainPending(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainAgain = false;
        let reads = 0;
        while (reads < 30) {
          const more = await this.readFromRadio();
          if (!more) break;
          reads++;
        }
      } while (this.drainAgain && this.isConnected);
    } finally {
      this.draining = false;
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
      // Bail immediately if the link dropped mid-drain — otherwise this loop
      // spins to its full 10s timeout while connect() holds isConnecting=true,
      // blocking the reconnect attempt and wedging the UI on 'reconnecting'.
      if (!this.isConnected) break;
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
      this.drainPending();
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
    // Write a heartbeat every 60s (Meshtastic clients do; the firmware answers
    // with a queue-status frame). Not what keeps the link up: on the nRF52
    // T-Echo, firmware's "lost phone" check is Bluefruit.connected() on the
    // physical link (NRF52Bluetooth.cpp checkIsConnected), with no idle timer.
    // That matters because this interval doesn't run while iOS has us
    // suspended in the background; it just catches up on the next wake.
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
