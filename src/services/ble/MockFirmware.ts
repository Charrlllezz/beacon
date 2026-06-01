import {
  encodeFromRadioMyInfo,
  encodeFromRadioNodeInfo,
  encodeFromRadioChannel,
  encodeFromRadioMetadata,
  encodeFromRadioConfigComplete,
  encodeFromRadioRebooted,
  encodeFromRadioPacket,
  RNDVU_CHANNEL_NAME,
  RNDVU_CHANNEL_PSK,
} from './MeshtasticCodec';
import type { NodeInfo, MeshPacket } from '../../types/mesh';

// ── Raw protobuf parsing helper (duplicated minimal copy of codec internals) ─
// We need to parse incoming ToRadio bytes to dispatch admin messages. The
// codec's parseFields is not exported; re-implementing it here keeps the
// module boundary clean and avoids cyclic dependencies.

const WIRE_VARINT = 0;
const WIRE_LEN = 2;

function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

function parseFields(buf: Uint8Array): Map<number, Uint8Array[]> {
  const fields = new Map<number, Uint8Array[]>();
  let pos = 0;
  while (pos < buf.length) {
    const [tag, nextPos] = readVarint(buf, pos);
    pos = nextPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x7;
    let value: Uint8Array;
    if (wireType === WIRE_VARINT) {
      const [_, p] = readVarint(buf, pos);
      value = buf.slice(nextPos, p); // store raw bytes for callers
      pos = p;
    } else if (wireType === WIRE_LEN) {
      const [len, p] = readVarint(buf, pos);
      value = buf.slice(p, p + len);
      pos = p + len;
    } else if (wireType === 5) { // WIRE_32BIT
      value = buf.slice(pos, pos + 4);
      pos += 4;
    } else if (wireType === 1) { // WIRE_64BIT
      value = buf.slice(pos, pos + 8);
      pos += 8;
    } else {
      break;
    }
    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum)!.push(value);
  }
  return fields;
}

function varintOf(buf: Uint8Array): number {
  const [v] = readVarint(buf, 0);
  return v;
}

function readString(buf: Uint8Array): string {
  try { return new TextDecoder().decode(buf); } catch { return ''; }
}

// ── Firmware state ──────────────────────────────────────────────────────────

export interface MockFirmwareOptions {
  myNodeNum: number;
  firmwareVersion?: string;
  hwModel?: number;
  // NodeDB: peers the firmware will advertise during config drain.
  peers?: NodeInfo[];
  // Starts with RNDVU channel pre-provisioned. Set false to simulate a fresh
  // factory-reset device that needs onboarding to write setChannel.
  preProvisioned?: boolean;
}

type Listener = () => void;

/**
 * Virtual Meshtastic firmware running in-process. Maintains device state
 * (owner, channel config, nodeDB), consumes ToRadio bytes from the app, and
 * produces real FromRadio protobuf frames via the encoders. Our
 * MockBleManager transport reads frames via getNextFromRadioFrame() and
 * delivers them to the app by calling decodeFromRadio — same path as
 * hardware-read bytes.
 */
export class MockFirmware {
  readonly myNodeNum: number;
  owner: { id: string; longName: string; shortName: string };
  primaryChannel: { index: number; name: string; role: number };
  loraConfig: { region: number; txEnabled: boolean; usePreset: boolean };
  firmwareVersion: string;
  hwModel: number;
  nodeDB: Map<number, NodeInfo> = new Map();
  rebootCount = 0;
  private outputBuffer: Uint8Array[] = [];
  private listeners = new Set<Listener>();
  private lastConfigId: number | null = null;
  private pendingReboot: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: MockFirmwareOptions) {
    this.myNodeNum = opts.myNodeNum;
    this.firmwareVersion = opts.firmwareVersion ?? '2.5.17-mock';
    this.hwModel = opts.hwModel ?? 7; // T_ECHO
    // Default factory state: device ID derived from node num, blank names.
    this.owner = {
      id: '!' + opts.myNodeNum.toString(16).padStart(8, '0'),
      longName: '',
      shortName: '',
    };
    // Pre-provisioned by default so "connect to existing device" works; tests
    // can pass preProvisioned=false to simulate a fresh factory-reset T-Echo.
    if (opts.preProvisioned !== false) {
      this.primaryChannel = { index: 0, name: RNDVU_CHANNEL_NAME, role: 1 };
      this.loraConfig = { region: 1, txEnabled: true, usePreset: true };
    } else {
      this.primaryChannel = { index: 0, name: '', role: 0 }; // DISABLED
      this.loraConfig = { region: 0, txEnabled: false, usePreset: false };
    }
    for (const p of opts.peers ?? []) {
      this.nodeDB.set(p.num, p);
    }
  }

  // ── Output queue ─────────────────────────────────────────────────────────

  /** Called by MockBleManager to check for a frame to emit via readFromRadio. */
  getNextFromRadioFrame(): Uint8Array | null {
    return this.outputBuffer.shift() ?? null;
  }

  /** Subscribe to "there's new data available" ticks (like FROM_NUM notify). */
  onOutputAvailable(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private enqueue(frame: Uint8Array) {
    this.outputBuffer.push(frame);
    this.listeners.forEach(cb => cb());
  }

  /** Called by VirtualPeer (or scenarios) to inject a mesh packet. */
  injectMeshPacket(packet: MeshPacket) {
    this.enqueue(encodeFromRadioPacket(packet));
  }

  /** Called by VirtualPeer to announce a node via NodeInfo (updates nodeDB). */
  injectNodeInfo(info: NodeInfo) {
    this.nodeDB.set(info.num, info);
    this.enqueue(encodeFromRadioNodeInfo(info));
  }

  // ── Inputs from the phone (ToRadio) ──────────────────────────────────────

  /**
   * Parse a ToRadio message and dispatch. Mirrors what real firmware does
   * when the phone writes to TO_RADIO characteristic.
   *
   * ToRadio { oneof payload_variant {
   *   MeshPacket packet = 1;
   *   uint32 want_config_id = 3;
   *   ...
   *   Heartbeat heartbeat = 7;
   * }}
   */
  handleToRadio(bytes: Uint8Array): void {
    const fields = parseFields(bytes);

    // want_config_id → start config drain
    if (fields.has(3)) {
      const configId = varintOf(fields.get(3)![0]);
      this.startConfigDrain(configId);
      return;
    }

    // MeshPacket from phone → either a broadcast to mesh or admin to self
    if (fields.has(1)) {
      this.handleOutgoingMeshPacket(fields.get(1)![0]);
      return;
    }

    // Heartbeat → no-op (real firmware just resets the phone_timeout timer)
    if (fields.has(7)) return;
  }

  private handleOutgoingMeshPacket(packetBytes: Uint8Array) {
    const pf = parseFields(packetBytes);
    // from=1 fixed32, to=2 fixed32, decoded=4
    // Admin messages are recognized by destination==self AND portnum==ADMIN_APP (6).
    if (!pf.has(4)) return; // encrypted or empty payload; ignore
    const dataBytes = pf.get(4)![0];
    const df = parseFields(dataBytes);
    const portnum = df.has(1) ? varintOf(df.get(1)![0]) : 0;
    const payload = df.has(2) ? df.get(2)![0] : new Uint8Array(0);

    if (portnum === 6 /* ADMIN_APP */) {
      this.handleAdminMessage(payload);
    }
    // Other portnums (TEXT, POSITION, etc.) = outbound broadcast. In a real
    // mesh these would reach peers. For our mock, there's no propagation
    // loop; peers are scripted. So we ignore outgoing non-admin packets.
  }

  /**
   * Dispatch an AdminMessage field. See admin.proto for the full oneof.
   * Fields we implement:
   *   set_owner (32)            → update owner, broadcast self NodeInfo
   *   set_channel (33)          → update primaryChannel, broadcast Channel
   *   set_config (34)           → apply Config submessage (lora, position, …)
   *   set_module_config (35)    → ignored (not used by RNDVU)
   *   begin_edit_settings (64)  → open transaction (no-op, we apply eagerly)
   *   commit_edit_settings (65) → close transaction (no-op)
   *   reboot_seconds (97)       → schedule reboot
   *   factory_reset_device (94) → wipe state + schedule reboot
   */
  private handleAdminMessage(adminBytes: Uint8Array) {
    const f = parseFields(adminBytes);

    if (f.has(32)) this.handleSetOwner(f.get(32)![0]);
    if (f.has(33)) this.handleSetChannel(f.get(33)![0]);
    if (f.has(34)) this.handleSetConfig(f.get(34)![0]);
    if (f.has(64)) { /* begin_edit_settings — no-op */ }
    if (f.has(65)) { /* commit_edit_settings — no-op */ }
    if (f.has(94)) this.handleFactoryReset();
    if (f.has(97)) this.handleReboot(varintOf(f.get(97)![0]));
  }

  private handleSetOwner(userBytes: Uint8Array) {
    const u = parseFields(userBytes);
    if (u.has(1)) this.owner.id = readString(u.get(1)![0]);
    if (u.has(2)) this.owner.longName = readString(u.get(2)![0]);
    if (u.has(3)) this.owner.shortName = readString(u.get(3)![0]);
    // Real firmware broadcasts updated NodeInfo for self. Do the same so
    // PacketRouter sees the new name reach our own crewMembers entry.
    this.enqueue(encodeFromRadioNodeInfo(this.buildSelfNodeInfo()));
  }

  private handleSetChannel(channelBytes: Uint8Array) {
    const c = parseFields(channelBytes);
    const index = c.has(1) ? varintOf(c.get(1)![0]) : 0;
    let name = '';
    if (c.has(2)) {
      const sf = parseFields(c.get(2)![0]);
      if (sf.has(3)) name = readString(sf.get(3)![0]);
    }
    const role = c.has(3) ? varintOf(c.get(3)![0]) : 0;
    if (role === 1 /* PRIMARY */) {
      this.primaryChannel = { index, name, role };
    }
    // Echo the channel back so the app's PacketRouter updates channelName.
    this.enqueue(encodeFromRadioChannel({ index, name, role }));
  }

  private handleSetConfig(configBytes: Uint8Array) {
    // Config { oneof payload_variant { DeviceConfig=1, PositionConfig=2, ...
    //                                  LoRaConfig=6, ... } }
    const c = parseFields(configBytes);
    if (c.has(6)) {
      // LoRaConfig
      const l = parseFields(c.get(6)![0]);
      const usePreset = l.has(1) ? varintOf(l.get(1)![0]) !== 0 : false;
      const region = l.has(7) ? varintOf(l.get(7)![0]) : 0;
      const txEnabled = l.has(9) ? varintOf(l.get(9)![0]) !== 0 : false;
      // Defensive check that would have caught the partial-write bug: if a
      // caller hands us tx_enabled=false while region is nonzero (i.e.
      // looks like a real config attempt), log a warning. Real firmware
      // just silently applies it; we're louder for testing's sake.
      if (region !== 0 && !txEnabled) {
        // eslint-disable-next-line no-console
        console.warn('[MockFirmware] incoming LoRaConfig sets tx_enabled=false while region is set — this would brick a real radio. Was your encoder partial?');
      }
      this.loraConfig = { region, txEnabled, usePreset };
    }
    // PositionConfig (field 2), DeviceConfig (field 1), etc. not tracked.
  }

  private handleReboot(seconds: number) {
    if (this.pendingReboot) clearTimeout(this.pendingReboot);
    const delay = Math.max(seconds, 1) * 1000;
    this.pendingReboot = setTimeout(() => this.performReboot(), delay);
  }

  private handleFactoryReset() {
    // Wipe state that persists across normal boots. myNodeNum survives (it's
    // derived from the MAC/hardware ID).
    this.owner = {
      id: '!' + this.myNodeNum.toString(16).padStart(8, '0'),
      longName: '',
      shortName: '',
    };
    this.primaryChannel = { index: 0, name: '', role: 0 };
    this.loraConfig = { region: 0, txEnabled: false, usePreset: false };
    this.nodeDB.clear();
    // Real firmware factory_reset_device triggers a reboot shortly after.
    this.handleReboot(2);
  }

  private performReboot() {
    this.rebootCount += 1;
    // Drop any queued output — firmware starts with an empty FIFO.
    this.outputBuffer = [];
    // Tell the app we rebooted. Most hardware does this; the Stream API sends
    // the rebooted=true frame after startup. The MockBleManager transport
    // will also drop/re-establish the connection around this.
    this.enqueue(encodeFromRadioRebooted());
  }

  // ── Config drain ─────────────────────────────────────────────────────────

  /**
   * Mimic real firmware's response to want_config: emit myInfo → nodeInfos
   * (self + all peers) → channel → metadata → configCompleteId. This is the
   * byte stream our app's drainFromRadio loop consumes.
   */
  private startConfigDrain(configId: number) {
    this.lastConfigId = configId;
    this.enqueue(
      encodeFromRadioMyInfo({
        myNodeNum: this.myNodeNum,
        nodedbCount: this.nodeDB.size + 1, // +1 for self
        rebootCount: this.rebootCount,
      }),
    );
    // Self NodeInfo first (so myNodeNum has a matching entry in crewMembers).
    this.enqueue(encodeFromRadioNodeInfo(this.buildSelfNodeInfo()));
    // Peers from nodeDB.
    for (const peer of this.nodeDB.values()) {
      this.enqueue(encodeFromRadioNodeInfo(peer));
    }
    if (this.primaryChannel.role === 1) {
      this.enqueue(encodeFromRadioChannel({
        index: this.primaryChannel.index,
        name: this.primaryChannel.name,
        role: this.primaryChannel.role,
      }));
    }
    this.enqueue(encodeFromRadioMetadata({
      firmwareVersion: this.firmwareVersion,
      hwModel: this.hwModel,
      hasBluetooth: true,
      hasPKC: true,
    }));
    this.enqueue(encodeFromRadioConfigComplete(configId));
  }

  private buildSelfNodeInfo(): NodeInfo {
    return {
      num: this.myNodeNum,
      user: this.owner.longName
        ? { id: this.owner.id, longName: this.owner.longName, shortName: this.owner.shortName }
        : undefined,
      lastHeard: Math.floor(Date.now() / 1000),
      deviceMetrics: { batteryLevel: 73 },
    };
  }

  // ── Teardown ─────────────────────────────────────────────────────────────

  reset() {
    if (this.pendingReboot) clearTimeout(this.pendingReboot);
    this.pendingReboot = null;
    this.outputBuffer = [];
    this.listeners.clear();
  }
}

// Silence the unused suffix warning from TS5 on the throwaway in parseFields.
export const _INTERNAL = { RNDVU_CHANNEL_PSK };
