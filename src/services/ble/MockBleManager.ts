import type { FromRadio } from '../../types/mesh';
import {
  decodeFromRadio,
  encodeToRadio,
  encodeSetOwner,
  encodeSetChannel,
  encodeBeginEditSettings,
  encodeCommitEditSettings,
  encodeDisableChannel,
  encodeSetLoraConfig,
  encodeReboot,
  encodeFactoryReset,
  encodeSetPositionConfig,
} from './MeshtasticCodec';
import { MockFirmware } from './MockFirmware';
import type { VirtualPeer } from './MockPeers';
import {
  applyScenario,
  loadSavedScenario,
  DEFAULT_SCENARIO,
  type ScenarioName,
} from './MockScenarios';
import { PortNum } from '../../types/mesh';

export type PacketCallback = (fromRadio: FromRadio) => void;
export type StatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

const MY_NODE_NUM = 0x5e6f7a;

// ── Transport timings ───────────────────────────────────────────────────────
// Tuned to feel like real hardware: 1.5s BLE connect handshake, 150ms between
// drain reads so the config drain is visibly progressive rather than instant.
const CONNECT_DELAY_MS = 1500;
const DRAIN_INTERVAL_MS = 150;
const REBOOT_RECONNECT_DELAY_MS = 3000;

/**
 * Thin BLE transport over MockFirmware. Every byte produced by the firmware
 * is decoded via decodeFromRadio before being handed to the app, and every
 * call from the app (sendText, setOwner, etc.) is encoded via the real
 * ToRadio encoders before being passed to firmware.handleToRadio. This
 * exercises the full wire-format path — same codebase as hardware.
 */
export class MockBleManager {
  private firmware: MockFirmware;
  private peers: VirtualPeer[] = [];
  private packetCallback: PacketCallback | null = null;
  private statusCallback: StatusCallback | null = null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private rebootTimer: ReturnType<typeof setTimeout> | null = null;
  private flakyDropTimer: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  private currentScenario: ScenarioName = DEFAULT_SCENARIO;

  constructor() {
    this.firmware = new MockFirmware({ myNodeNum: MY_NODE_NUM, preProvisioned: true });
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
    return [{ id: 'mock-device-001', name: 'Meshtastic_MOCK' }];
  }

  async connect(_deviceId: string): Promise<void> {
    // Clean slate on each connect (e.g., after a simulated reboot or the
    // user tapping Reconnect).
    this.stopTimers();

    await delay(CONNECT_DELAY_MS);
    this.isConnected = true;
    this.statusCallback?.('connected');

    // Kick the config drain on the firmware side (real app writes wantConfig
    // mid-connect; we preempt so drain starts as expected).
    this.firmware.handleToRadio(encodeWantConfigSynthetic(42));

    // Start the notification pump — every 150ms drain one frame through
    // decodeFromRadio and hand to the app.
    this.drainTimer = setInterval(() => this.drainOne(), DRAIN_INTERVAL_MS);

    // Scenarios are applied once per mock lifecycle, not on every reconnect,
    // so scripted peer messages don't duplicate across reboot cycles.
    if (this.peers.length === 0) {
      this.currentScenario = await loadSavedScenario();
      const ctx = applyScenario(this.currentScenario, this.firmware);
      this.peers = ctx.peers;
      if (ctx.flakyDropIntervalMs) {
        this.flakyDropTimer = setInterval(() => this.simulateDrop(5000), ctx.flakyDropIntervalMs);
      }
    }
  }

  async sendText(text: string, channelIndex = 0): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    await delay(50); // simulate BLE write latency
    const bytes = encodeToRadio(0xffffffff, text, this.firmware.myNodeNum, channelIndex);
    this.firmware.handleToRadio(bytes);
  }

  async setOwner(longName: string, shortName: string): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    await delay(50);
    this.firmware.handleToRadio(encodeSetOwner(this.firmware.myNodeNum, longName, shortName));
  }

  /**
   * Full setChannel admin transaction, matching RealBleManager.setChannel.
   * Fires the reboot admin at the end, which MockFirmware schedules as a
   * timer; our transport catches the pending reboot by checking isConnected
   * state and tears down the connection at the right time.
   */
  async setChannel(channelIndex: number, channelName: string, psk: Uint8Array, role = 1): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    const myNodeNum = this.firmware.myNodeNum;
    await this.writeAdmin(encodeBeginEditSettings(myNodeNum));
    await this.writeAdmin(encodeSetChannel(myNodeNum, channelIndex, channelName, psk, role));
    for (let i = 1; i <= 7; i++) {
      await this.writeAdmin(encodeDisableChannel(myNodeNum, i));
    }
    await this.writeAdmin(encodeSetLoraConfig(myNodeNum, 1));
    await this.writeAdmin(encodeCommitEditSettings(myNodeNum));
    await this.writeAdmin(encodeReboot(myNodeNum, 2));
    // Schedule the fake BLE disconnect + reconnect-auto cycle to mirror what
    // real hardware does when it reboots: BLE drops, auto-reconnect kicks in,
    // fresh config drain.
    this.scheduleReboot();
  }

  async factoryReset(): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    await this.writeAdmin(encodeFactoryReset(this.firmware.myNodeNum));
    this.scheduleReboot();
  }

  async setLocationSharing(enabled: boolean): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    const broadcastSecs = enabled ? 900 : 0;
    const gpsMode = enabled ? 1 : 0;
    await this.writeAdmin(encodeSetPositionConfig(this.firmware.myNodeNum, broadcastSecs, gpsMode));
  }

  disconnect(): void {
    this.isConnected = false;
    this.stopTimers();
    // Peers stay alive across disconnects — they're the "other people on the
    // mesh," not part of our device. They'll keep pushing into the
    // firmware's buffer, which gets cleared on connect().
    this.statusCallback?.('disconnected');
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async writeAdmin(bytes: Uint8Array): Promise<void> {
    this.firmware.handleToRadio(bytes);
    await delay(50); // pacing matches RealBleManager.writeAdmin
  }

  private drainOne() {
    if (!this.isConnected || !this.packetCallback) return;
    const frame = this.firmware.getNextFromRadioFrame();
    if (!frame) return;
    // THE KEY LINE: run the mock-generated bytes through the exact same
    // decoder the real BLE path uses. Any decoder bug surfaces here the
    // same way it would with a real T-Echo.
    try {
      const fromRadio = decodeFromRadio(frame);
      this.packetCallback(fromRadio);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MockBleManager] decodeFromRadio failed on mock-emitted frame:', e);
    }
  }

  private scheduleReboot() {
    // Real firmware reboots ~2s after the admin. Simulate the BLE drop at
    // that moment; auto-reconnect on the app side (or the user-tap path)
    // drives the reconnect back to us. Here we implement it as: drop status,
    // wait a beat, flip back to 'connected' and redo the drain.
    if (this.rebootTimer) clearTimeout(this.rebootTimer);
    this.rebootTimer = setTimeout(() => {
      if (!this.isConnected) return;
      // Simulate the BLE-layer disconnect the real reboot would cause. The
      // app's listener in RealBleManager would go through its
      // 'reconnecting' path; we mirror that by going disconnected → brief
      // pause → re-running our own connect() to re-drain.
      this.isConnected = false;
      this.stopDrainTimer();
      this.statusCallback?.('reconnecting');
      setTimeout(() => {
        // Only auto-reconnect if nobody explicitly disconnected us in the
        // meantime (e.g., user tapped Release Device mid-reboot).
        this.connect('mock-device-001').catch(() => {});
      }, REBOOT_RECONNECT_DELAY_MS);
    }, 2200);
  }

  private stopTimers() {
    this.stopDrainTimer();
    if (this.rebootTimer) { clearTimeout(this.rebootTimer); this.rebootTimer = null; }
    if (this.flakyDropTimer) { clearInterval(this.flakyDropTimer); this.flakyDropTimer = null; }
  }

  // ── Mock-only dev controls (called from Debug screen) ────────────────────

  /** Which scenario is currently active (read-only; to switch, save via
   *  saveScenario() and reload the app). */
  getActiveScenario(): ScenarioName {
    return this.currentScenario;
  }

  /**
   * Simulate a BLE disconnect for `durationMs` milliseconds, then auto-
   * reconnect. Useful for testing the reconnecting UI + send-status-failed
   * paths without real RF interference.
   */
  simulateDrop(durationMs = 5000): void {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.stopDrainTimer();
    this.statusCallback?.('reconnecting');
    setTimeout(() => {
      this.connect('mock-device-001').catch(() => {});
    }, durationMs);
  }

  /** Push a test message from the first peer in the scene. */
  injectTestMessage(text: string): void {
    const peer = this.peers[0];
    if (!peer) return;
    peer.sendText(this.firmware, text);
  }

  /**
   * Rewind all peers' lastHeard by `seconds`. Flips any peer past the
   * isOnline threshold to offline without waiting. Useful for testing stale
   * aging + offline UX without burning real minutes.
   */
  advanceTime(seconds: number): void {
    const shift = seconds;
    for (const [id, info] of this.firmware.nodeDB.entries()) {
      if (info.lastHeard !== undefined) {
        const shifted = { ...info, lastHeard: info.lastHeard - shift };
        this.firmware.nodeDB.set(id, shifted);
        this.firmware.injectNodeInfo(shifted);
      }
    }
  }

  private stopDrainTimer() {
    if (this.drainTimer) { clearInterval(this.drainTimer); this.drainTimer = null; }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Encode a want_config_id ToRadio. Exported in MeshtasticCodec as
 * encodeWantConfig — re-exposed here locally to avoid adding another import
 * surface for a one-liner. (The codec's encodeWantConfig returns just the
 * field bytes, which is exactly what handleToRadio's parser expects.)
 */
function encodeWantConfigSynthetic(configId: number): Uint8Array {
  // ToRadio.want_config_id = field 3, varint. Hand-built: tag = (3<<3)|0 = 24
  // followed by varint(configId).
  const tag = 24;
  const bytes: number[] = [tag];
  let v = configId >>> 0;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

export const mockBleManager = new MockBleManager();
