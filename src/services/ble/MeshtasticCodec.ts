import type { MeshPacket, FromRadio, Position, NodeInfo, Telemetry, Channel, DeviceMetadata } from '../../types/mesh';
import { PortNum } from '../../types/mesh';

// Minimal protobuf wire-format encoder/decoder for Meshtastic packets.
// Implements enough of the spec to handle TextMessage, Position, NodeInfo, Telemetry.

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LEN = 2;
const WIRE_32BIT = 5;

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

function writeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return bytes;
}

function decodeString(buf: Uint8Array): string {
  try {
    return new TextDecoder().decode(buf);
  } catch {
    return Array.from(buf).map(b => String.fromCharCode(b)).join('');
  }
}

function parseFields(buf: Uint8Array): Map<number, Uint8Array[]> {
  const fields = new Map<number, Uint8Array[]>();
  let pos = 0;
  while (pos < buf.length) {
    if (pos >= buf.length) break;
    const [tag, nextPos] = readVarint(buf, pos);
    pos = nextPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x7;

    let value: Uint8Array;
    try {
      if (wireType === WIRE_VARINT) {
        const [v, p] = readVarint(buf, pos);
        value = new Uint8Array(writeVarint(v));
        pos = p;
      } else if (wireType === WIRE_LEN) {
        const [len, p] = readVarint(buf, pos);
        value = buf.slice(p, p + len);
        pos = p + len;
      } else if (wireType === WIRE_32BIT) {
        value = buf.slice(pos, pos + 4);
        pos += 4;
      } else if (wireType === WIRE_64BIT) {
        value = buf.slice(pos, pos + 8);
        pos += 8;
      } else {
        break;
      }
    } catch {
      break;
    }

    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum)!.push(value);
  }
  return fields;
}

function varintVal(field: Uint8Array): number {
  const [v] = readVarint(field, 0);
  return v;
}

export function decodeFromRadio(bytes: Uint8Array): FromRadio {
  const fields = parseFields(bytes);
  const result: FromRadio = {};

  if (fields.has(1)) result.num = varintVal(fields.get(1)![0]);
  if (fields.has(2)) result.packet = decodeMeshPacket(fields.get(2)![0]);
  if (fields.has(3)) {
    const f = parseFields(fields.get(3)![0]);
    result.myInfo = {
      myNodeNum: f.has(1) ? varintVal(f.get(1)![0]) : 0,
      // nodedb_count tells us how many NodeInfo packets the device is about
      // to stream during the config drain — lets us terminate drainFromRadio
      // precisely instead of guessing with a fixed read cap.
      nodedbCount: f.has(15) ? varintVal(f.get(15)![0]) : undefined,
    };
  }
  if (fields.has(4)) result.nodeInfo = decodeNodeInfo(fields.get(4)![0]);
  if (fields.has(7)) result.configCompleteId = varintVal(fields.get(7)![0]);
  if (fields.has(8)) result.rebooted = varintVal(fields.get(8)![0]) !== 0;
  if (fields.has(10)) result.channel = decodeChannel(fields.get(10)![0]);
  if (fields.has(13)) result.metadata = decodeDeviceMetadata(fields.get(13)![0]);

  return result;
}

function decodeDeviceMetadata(bytes: Uint8Array): DeviceMetadata {
  const fields = parseFields(bytes);
  const meta: DeviceMetadata = {};
  if (fields.has(1)) meta.firmwareVersion = decodeString(fields.get(1)![0]);
  if (fields.has(4)) meta.hasWifi = varintVal(fields.get(4)![0]) !== 0;
  if (fields.has(5)) meta.hasBluetooth = varintVal(fields.get(5)![0]) !== 0;
  if (fields.has(9)) meta.hwModel = varintVal(fields.get(9)![0]);
  if (fields.has(11)) meta.hasPKC = varintVal(fields.get(11)![0]) !== 0;
  return meta;
}

function decodeChannel(bytes: Uint8Array): Channel {
  const fields = parseFields(bytes);
  const channel: Channel = { index: 0 };
  if (fields.has(1)) channel.index = varintVal(fields.get(1)![0]);
  if (fields.has(2)) {
    const sf = parseFields(fields.get(2)![0]);
    channel.settings = {
      name: sf.has(3) ? decodeString(sf.get(3)![0]) : undefined,
    };
  }
  if (fields.has(3)) channel.role = varintVal(fields.get(3)![0]);
  return channel;
}

function decodeMeshPacket(bytes: Uint8Array): MeshPacket {
  const fields = parseFields(bytes);
  const packet: MeshPacket = { from: 0, to: 0, channel: 0 };

  if (fields.has(1)) packet.from = fixed32Val(fields.get(1)![0]);   // fixed32
  if (fields.has(2)) packet.to = fixed32Val(fields.get(2)![0]);     // fixed32
  if (fields.has(3)) packet.channel = varintVal(fields.get(3)![0]); // uint32
  if (fields.has(4)) {                                               // decoded = field 4
    const df = parseFields(fields.get(4)![0]);
    packet.decoded = {
      portnum: df.has(1) ? varintVal(df.get(1)![0]) : 0,
      payload: df.has(2) ? df.get(2)![0] : new Uint8Array(),
    };
  }
  if (fields.has(6)) packet.id = fixed32Val(fields.get(6)![0]);     // fixed32
  if (fields.has(7)) packet.rxTime = fixed32Val(fields.get(7)![0]); // fixed32
  if (fields.has(8)) packet.rxSnr = float32Val(fields.get(8)![0]);  // float

  return packet;
}

function decodeNodeInfo(bytes: Uint8Array): NodeInfo {
  const fields = parseFields(bytes);
  const info: NodeInfo = { num: 0 };

  if (fields.has(1)) info.num = varintVal(fields.get(1)![0]);
  if (fields.has(2)) {
    const uf = parseFields(fields.get(2)![0]);
    info.user = {
      id: uf.has(1) ? decodeString(uf.get(1)![0]) : '',
      longName: uf.has(2) ? decodeString(uf.get(2)![0]) : 'Unknown',
      shortName: uf.has(3) ? decodeString(uf.get(3)![0]) : '???',
    };
  }
  if (fields.has(3)) {
    const pf = parseFields(fields.get(3)![0]);
    info.position = {
      latitudeI: pf.has(1) ? sfixed32Val(pf.get(1)![0]) : 0,   // sfixed32
      longitudeI: pf.has(2) ? sfixed32Val(pf.get(2)![0]) : 0,  // sfixed32
      altitude: pf.has(3) ? varintVal(pf.get(3)![0]) : undefined,
      time: pf.has(4) ? fixed32Val(pf.get(4)![0]) : undefined,  // fixed32
    };
  }
  if (fields.has(4)) info.snr = float32Val(fields.get(4)![0]);    // float
  if (fields.has(5)) info.lastHeard = fixed32Val(fields.get(5)![0]);
  if (fields.has(6)) {
    const dmf = parseFields(fields.get(6)![0]);
    info.deviceMetrics = {
      batteryLevel: dmf.has(1) ? varintVal(dmf.get(1)![0]) : undefined,
    };
  }

  return info;
}

export function decodeTextMessage(payload: Uint8Array): string {
  return decodeString(payload);
}

export function decodePosition(payload: Uint8Array): Position {
  const fields = parseFields(payload);
  return {
    latitudeI: fields.has(1) ? sfixed32Val(fields.get(1)![0]) : 0,   // sfixed32
    longitudeI: fields.has(2) ? sfixed32Val(fields.get(2)![0]) : 0,  // sfixed32
    altitude: fields.has(3) ? varintVal(fields.get(3)![0]) : undefined,
    time: fields.has(4) ? fixed32Val(fields.get(4)![0]) : undefined,  // fixed32
  };
}

export function decodeTelemetry(payload: Uint8Array): Telemetry {
  const fields = parseFields(payload);
  const result: Telemetry = { time: Math.floor(Date.now() / 1000) };
  if (fields.has(1)) result.time = fixed32Val(fields.get(1)![0]); // fixed32
  if (fields.has(2)) {
    const df = parseFields(fields.get(2)![0]);
    result.deviceMetrics = {
      batteryLevel: df.has(1) ? varintVal(df.get(1)![0]) : undefined,
    };
  }
  return result;
}

// ── Encoder helpers ──────────────────────────────────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function varField(fieldNum: number, value: number): Uint8Array {
  const tag = new Uint8Array(writeVarint((fieldNum << 3) | WIRE_VARINT));
  return concat(tag, new Uint8Array(writeVarint(value)));
}

function lenField(fieldNum: number, value: Uint8Array): Uint8Array {
  const tag = new Uint8Array(writeVarint((fieldNum << 3) | WIRE_LEN));
  const len = new Uint8Array(writeVarint(value.length));
  return concat(tag, len, value);
}

function fixed32Field(fieldNum: number, value: number): Uint8Array {
  const tag = new Uint8Array(writeVarint((fieldNum << 3) | WIRE_32BIT));
  const val = new Uint8Array(4);
  val[0] = value & 0xff;
  val[1] = (value >>> 8) & 0xff;
  val[2] = (value >>> 16) & 0xff;
  val[3] = (value >>> 24) & 0xff;
  return concat(tag, val);
}

function fixed32Val(field: Uint8Array): number {
  return (field[0] | (field[1] << 8) | (field[2] << 16) | (field[3] << 24)) >>> 0;
}

function floatField(fieldNum: number, value: number): Uint8Array {
  const tag = new Uint8Array(writeVarint((fieldNum << 3) | WIRE_32BIT));
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true); // little-endian IEEE 754
  return concat(tag, new Uint8Array(buf));
}

function stringField(fieldNum: number, value: string): Uint8Array {
  return lenField(fieldNum, new TextEncoder().encode(value));
}

function sfixed32Val(field: Uint8Array): number {
  // Signed 32-bit: JS bitwise OR returns signed int32
  return field[0] | (field[1] << 8) | (field[2] << 16) | (field[3] << 24);
}

function float32Val(field: Uint8Array): number {
  // IEEE 754 little-endian. Copy into a fresh buffer to avoid byteOffset
  // assumptions about how parseFields sliced the source.
  const buf = new ArrayBuffer(4);
  const bytes = new Uint8Array(buf);
  bytes[0] = field[0];
  bytes[1] = field[1];
  bytes[2] = field[2];
  bytes[3] = field[3];
  return new DataView(buf).getFloat32(0, true);
}

export function encodeToRadio(to: number, text: string, myNodeNum: number, channelIndex = 0): Uint8Array {
  const textBytes = new TextEncoder().encode(text);
  const dataPayload = concat(varField(1, PortNum.TEXT_MESSAGE_APP), lenField(2, textBytes));
  const isBroadcast = to === 0xffffffff;
  // want_ack on a broadcast triggers Meshtastic's reliable-broadcast flood:
  // every receiver re-transmits as implicit ACK and the sender retries up to
  // max_retransmissions times. On a dense channel that burns airtime and
  // stalls messages for minutes. Fire-and-forget for broadcasts, keep ACK
  // for unicast.
  const parts: Uint8Array[] = [
    fixed32Field(1, myNodeNum),   // from: fixed32
    fixed32Field(2, to),          // to: fixed32
    varField(3, channelIndex),    // channel: uint32
    lenField(4, dataPayload),     // decoded: field 4
  ];
  if (!isBroadcast) parts.push(varField(10, 1)); // want_ack: field 10
  const meshPacket = concat(...parts);
  return lenField(1, meshPacket);
}

export function encodeWantConfig(configId: number): Uint8Array {
  return varField(3, configId);
}

/**
 * ToRadio.heartbeat — an empty message in field 7. Writing this periodically
 * prevents the firmware's phone_timeout_secs from disconnecting the BLE link
 * when the app is idle.
 */
export function encodeHeartbeat(): Uint8Array {
  return lenField(7, new Uint8Array(0));
}

// ── Channel configuration (AdminMessage) ────────────────────────────────────

/**
 * The single RNDVU crew channel — hardcoded name + 32-byte PSK so every RNDVU
 * build produces matching crew membership without out-of-band QR provisioning.
 * Model 1 provisioning (single shared crew). Model 2 (per-crew PSKs via invite
 * URL) will generate random PSKs at runtime and store them in AsyncStorage,
 * calling the same setChannel path.
 */
export const RNDVU_CHANNEL_NAME = 'RNDVU';
export const RNDVU_CHANNEL_PSK = new Uint8Array([
  0x34, 0xa7, 0x7f, 0xe7, 0x22, 0xa8, 0x88, 0x78,
  0xd0, 0xe2, 0xfb, 0x89, 0xdd, 0x8f, 0xd5, 0xe9,
  0x28, 0x0c, 0x34, 0x6c, 0xdf, 0xfc, 0x0a, 0x13,
  0x85, 0xba, 0xbe, 0x56, 0xd9, 0x1a, 0x0f, 0xe3,
]);

/**
 * Encode a Meshtastic Channel protobuf.
 *
 * Channel {
 *   int32  index    = 1;
 *   ChannelSettings settings = 2;  // nested
 *   ChannelRole role = 3;
 * }
 * ChannelSettings {
 *   uint32 channel_num = 1; // deprecated
 *   bytes  psk         = 2;
 *   string name        = 3;
 * }
 * ChannelRole: DISABLED=0, PRIMARY=1, SECONDARY=2
 */
function encodeChannel(index: number, name: string, psk: Uint8Array, role: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const settings = concat(
    lenField(2, psk),        // ChannelSettings.psk = field 2
    lenField(3, nameBytes),  // ChannelSettings.name = field 3
  );
  return concat(
    varField(1, index),      // Channel.index
    lenField(2, settings),   // Channel.settings
    varField(3, role),       // Channel.role (PRIMARY=1)
  );
}

/**
 * Encode a ToRadio packet containing an AdminMessage that sets a channel.
 *
 * AdminMessage { Channel set_channel = 33; }
 *
 * The admin packet is sent as a MeshPacket with portnum=ADMIN_APP,
 * addressed to the local node (myNodeNum) so the device applies it to itself.
 */
/**
 * Wrap an AdminMessage payload in a ToRadio MeshPacket addressed to self.
 */
function encodeAdminToRadio(myNodeNum: number, adminPayload: Uint8Array): Uint8Array {
  const dataPayload = concat(
    varField(1, PortNum.ADMIN_APP),  // Data.portnum
    lenField(2, adminPayload),       // Data.payload
    varField(3, 1),                  // Data.want_response
  );

  const meshPacket = concat(
    fixed32Field(1, myNodeNum),  // from: fixed32
    fixed32Field(2, myNodeNum),  // to: fixed32 (self for admin)
    varField(3, 0),              // channel: uint32
    lenField(4, dataPayload),    // decoded: field 4
    varField(10, 1),             // want_ack: field 10
  );

  return lenField(1, meshPacket); // ToRadio.packet
}

/**
 * AdminMessage { bool begin_edit_settings = 64; }
 * Must be sent before set_channel to start a config transaction.
 */
export function encodeBeginEditSettings(myNodeNum: number): Uint8Array {
  const adminMessage = varField(64, 1); // begin_edit_settings = true
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * AdminMessage { bool commit_edit_settings = 65; }
 * Must be sent after set_channel to persist the config transaction.
 */
export function encodeCommitEditSettings(myNodeNum: number): Uint8Array {
  const adminMessage = varField(65, 1); // commit_edit_settings = true
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * Encode a ToRadio admin packet that disables a channel.
 * Sets role=DISABLED (0) with empty settings.
 */
export function encodeDisableChannel(myNodeNum: number, channelIndex: number): Uint8Array {
  const channel = concat(
    varField(1, channelIndex),          // Channel.index
    varField(3, 0),                     // Channel.role = DISABLED
  );
  const adminMessage = lenField(33, channel); // AdminMessage.set_channel = field 33
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * Encode a ToRadio admin packet that sets the full LoRa config.
 *
 * AdminMessage { Config set_config = 34; }
 * Config { LoRaConfig lora = 6; }
 *
 * LoRaConfig fields this writes (must be complete — proto3 defaults silently
 * clobber unset fields, and an earlier partial write disabled tx_enabled and
 * use_preset, bricking the radio):
 *   use_preset    = field 1 (bool)  — true, so modem_preset drives everything
 *   modem_preset  = field 2 (enum)  — LONG_FAST (0)
 *   region        = field 7 (enum)  — param, US=1 for our test group
 *   hop_limit     = field 8 (uint32) — 3, Meshtastic default
 *   tx_enabled    = field 9 (bool)  — true, radio TX allowed
 */
export function encodeSetLoraConfig(myNodeNum: number, region: number): Uint8Array {
  const loraConfig = concat(
    varField(1, 1),         // use_preset = true
    varField(2, 0),         // modem_preset = LONG_FAST
    varField(7, region),    // region
    varField(8, 3),         // hop_limit = 3
    varField(9, 1),         // tx_enabled = true
  );
  const config = lenField(6, loraConfig);       // Config.lora = field 6
  const adminMessage = lenField(34, config);    // AdminMessage.set_config = field 34
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * AdminMessage { int32 reboot_seconds = 97; }
 * Tells the device to reboot after N seconds. Needed after config changes.
 */
export function encodeReboot(myNodeNum: number, seconds: number): Uint8Array {
  const adminMessage = varField(97, seconds);
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * AdminMessage { int32 factory_reset_device = 94; }
 * Wipes ALL device state — config, nodeDB, channel table, PKI keypair.
 * Device reboots; firmware regenerates a fresh keypair on boot. After the
 * app reconnects, setChannel + setOwner re-provision everything. This is
 * what removes the main reason testers needed the Meshtastic app.
 */
export function encodeFactoryReset(myNodeNum: number): Uint8Array {
  const adminMessage = varField(94, 1);
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * Write a COMPLETE PositionConfig so proto3 defaults don't clobber unset
 * fields — same hazard that bricked the LoRaConfig path before we fixed it.
 *
 * PositionConfig fields (all explicit):
 *   position_broadcast_secs         = 1  (uint32)  — 0 means "default", we want explicit
 *   position_broadcast_smart_enabled = 2 (bool)
 *   fixed_position                  = 3  (bool)
 *   gps_update_interval             = 5  (uint32, seconds)
 *   position_flags                  = 7  (uint32 bitfield)
 *   gps_mode                        = 13 (enum: DISABLED=0, ENABLED=1, NOT_PRESENT=2)
 *
 * NOTE: This encoder is untested on real hardware. The caller (RealBleManager.
 * setLocationSharing) and UI wiring are intentionally left as a followup so
 * we don't ship untested admin writes that could disable the device radio.
 */
export function encodeSetPositionConfig(
  myNodeNum: number,
  broadcastSecs: number,
  gpsMode: number,
): Uint8Array {
  const positionConfig = concat(
    varField(1, broadcastSecs),  // position_broadcast_secs
    varField(2, 0),              // position_broadcast_smart_enabled = false
    varField(3, 0),              // fixed_position = false
    varField(5, 120),            // gps_update_interval = 120s
    varField(7, 0),              // position_flags = 0 (default, no flags)
    varField(13, gpsMode),       // gps_mode
  );
  const config = lenField(2, positionConfig);   // Config.position = field 2
  const adminMessage = lenField(34, config);    // AdminMessage.set_config
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * AdminMessage.set_owner = 32 (User)
 * User {
 *   string id         = 1;  // "!" + hex of node num
 *   string long_name  = 2;
 *   string short_name = 3;
 * }
 *
 * Writes the user's display name to the T-Echo so it broadcasts over the mesh
 * in NodeInfo packets. Without this, peers see this node as "Unknown".
 */
export function encodeSetOwner(myNodeNum: number, longName: string, shortName: string): Uint8Array {
  const id = '!' + myNodeNum.toString(16).padStart(8, '0');
  const idBytes = new TextEncoder().encode(id);
  const longNameBytes = new TextEncoder().encode(longName.substring(0, 40));
  const shortNameBytes = new TextEncoder().encode(shortName.substring(0, 4));

  const user = concat(
    lenField(1, idBytes),         // User.id
    lenField(2, longNameBytes),   // User.long_name
    lenField(3, shortNameBytes),  // User.short_name
  );

  const adminMessage = lenField(32, user); // AdminMessage.set_owner
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

/**
 * AdminMessage { Channel set_channel = 33; }
 */
export function encodeSetChannel(
  myNodeNum: number,
  channelIndex: number,
  channelName: string,
  psk: Uint8Array,
  role = 1,  // PRIMARY
): Uint8Array {
  const channel = encodeChannel(channelIndex, channelName, psk, role);
  const adminMessage = lenField(33, channel); // AdminMessage.set_channel = field 33
  return encodeAdminToRadio(myNodeNum, adminMessage);
}

// ── FromRadio encoders (for the MockFirmware simulator) ─────────────────────
//
// These produce the exact bytes a real T-Echo would emit on FROM_RADIO. The
// mock firmware builds its outputs through these; the app's decodeFromRadio
// parses them through the same code path as real hardware. This is the key
// to the mock actually exercising our decoder, not shortcutting it.

/**
 * User { string id=1, string long_name=2, string short_name=3 }
 */
export function encodeUser(user: { id?: string; longName?: string; shortName?: string }): Uint8Array {
  const parts: Uint8Array[] = [];
  if (user.id) parts.push(stringField(1, user.id));
  if (user.longName) parts.push(stringField(2, user.longName));
  if (user.shortName) parts.push(stringField(3, user.shortName));
  return parts.length ? concat(...parts) : new Uint8Array(0);
}

/**
 * Position { sfixed32 latitude_i=1, sfixed32 longitude_i=2, int32 altitude=3, fixed32 time=4 }
 * fixed32Field handles sfixed32 too — same wire representation, different interpretation.
 */
export function encodePosition(pos: Position): Uint8Array {
  const parts: Uint8Array[] = [
    fixed32Field(1, pos.latitudeI),
    fixed32Field(2, pos.longitudeI),
  ];
  if (pos.altitude !== undefined) parts.push(varField(3, pos.altitude));
  if (pos.time !== undefined) parts.push(fixed32Field(4, pos.time));
  return concat(...parts);
}

/**
 * DeviceMetrics { uint32 battery_level=1, float voltage=2, float channel_utilization=3, float air_util_tx=4, uint32 uptime_seconds=5 }
 */
export function encodeDeviceMetrics(m: {
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (m.batteryLevel !== undefined) parts.push(varField(1, m.batteryLevel));
  if (m.voltage !== undefined) parts.push(floatField(2, m.voltage));
  if (m.channelUtilization !== undefined) parts.push(floatField(3, m.channelUtilization));
  if (m.airUtilTx !== undefined) parts.push(floatField(4, m.airUtilTx));
  return parts.length ? concat(...parts) : new Uint8Array(0);
}

/**
 * NodeInfo { num=1, user=2, position=3, float snr=4, fixed32 last_heard=5, device_metrics=6 }
 */
export function encodeNodeInfo(info: NodeInfo): Uint8Array {
  const parts: Uint8Array[] = [varField(1, info.num)];
  if (info.user) parts.push(lenField(2, encodeUser(info.user)));
  if (info.position) parts.push(lenField(3, encodePosition(info.position)));
  if (info.snr !== undefined) parts.push(floatField(4, info.snr));
  if (info.lastHeard !== undefined) parts.push(fixed32Field(5, info.lastHeard));
  if (info.deviceMetrics) parts.push(lenField(6, encodeDeviceMetrics(info.deviceMetrics)));
  return concat(...parts);
}

/**
 * Data { PortNum portnum=1, bytes payload=2, bool want_response=3 }
 */
export function encodeData(portnum: number, payload: Uint8Array, wantResponse = false): Uint8Array {
  const parts: Uint8Array[] = [varField(1, portnum), lenField(2, payload)];
  if (wantResponse) parts.push(varField(3, 1));
  return concat(...parts);
}

/**
 * MeshPacket (incoming from peer): from=1 fixed32, to=2 fixed32, channel=3,
 * decoded=4, id=6 fixed32, rx_time=7 fixed32, float rx_snr=8
 */
export function encodeMeshPacket(pkt: MeshPacket): Uint8Array {
  const parts: Uint8Array[] = [
    fixed32Field(1, pkt.from),
    fixed32Field(2, pkt.to),
    varField(3, pkt.channel),
  ];
  if (pkt.decoded) parts.push(lenField(4, encodeData(pkt.decoded.portnum, pkt.decoded.payload)));
  if (pkt.id !== undefined) parts.push(fixed32Field(6, pkt.id));
  if (pkt.rxTime !== undefined) parts.push(fixed32Field(7, pkt.rxTime));
  if (pkt.rxSnr !== undefined) parts.push(floatField(8, pkt.rxSnr));
  return concat(...parts);
}

/**
 * MyNodeInfo { my_node_num=1, reboot_count=8, min_app_version=11,
 *              firmware_edition=14, nodedb_count=15 }
 */
export function encodeMyNodeInfo(info: {
  myNodeNum: number;
  rebootCount?: number;
  minAppVersion?: number;
  firmwareEdition?: number;
  nodedbCount?: number;
}): Uint8Array {
  const parts: Uint8Array[] = [varField(1, info.myNodeNum)];
  if (info.rebootCount !== undefined) parts.push(varField(8, info.rebootCount));
  if (info.minAppVersion !== undefined) parts.push(varField(11, info.minAppVersion));
  if (info.firmwareEdition !== undefined) parts.push(varField(14, info.firmwareEdition));
  if (info.nodedbCount !== undefined) parts.push(varField(15, info.nodedbCount));
  return concat(...parts);
}

/**
 * DeviceMetadata { firmware_version=1 string, hasWifi=4 bool, hasBluetooth=5 bool,
 *                  hw_model=9 enum, hasPKC=11 bool }
 */
export function encodeDeviceMetadata(meta: {
  firmwareVersion?: string;
  hasWifi?: boolean;
  hasBluetooth?: boolean;
  hwModel?: number;
  hasPKC?: boolean;
}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (meta.firmwareVersion) parts.push(stringField(1, meta.firmwareVersion));
  if (meta.hasWifi !== undefined) parts.push(varField(4, meta.hasWifi ? 1 : 0));
  if (meta.hasBluetooth !== undefined) parts.push(varField(5, meta.hasBluetooth ? 1 : 0));
  if (meta.hwModel !== undefined) parts.push(varField(9, meta.hwModel));
  if (meta.hasPKC !== undefined) parts.push(varField(11, meta.hasPKC ? 1 : 0));
  return parts.length ? concat(...parts) : new Uint8Array(0);
}

/**
 * Channel (as emitted on FromRadio) { index=1 int32, settings=2, role=3 enum }
 * Only encodes `name` inside settings — that's all our app decodes. Mock
 * doesn't need to transport the real PSK back to itself.
 */
export function encodeChannelMessage(channel: {
  index: number;
  name?: string;
  role?: number;
}): Uint8Array {
  const parts: Uint8Array[] = [varField(1, channel.index)];
  if (channel.name) {
    parts.push(lenField(2, stringField(3, channel.name))); // settings { name }
  }
  if (channel.role !== undefined) parts.push(varField(3, channel.role));
  return concat(...parts);
}

// ── FromRadio frame wrappers ────────────────────────────────────────────────
// Each produces a complete FromRadio frame (what the mock transport emits
// to the app's readFromRadio). Top-level fields are the variant tag numbers
// from mesh.proto FromRadio.payload_variant.

/** FromRadio.packet = field 2 */
export function encodeFromRadioPacket(packet: MeshPacket): Uint8Array {
  return lenField(2, encodeMeshPacket(packet));
}

/** FromRadio.my_info = field 3 */
export function encodeFromRadioMyInfo(info: Parameters<typeof encodeMyNodeInfo>[0]): Uint8Array {
  return lenField(3, encodeMyNodeInfo(info));
}

/** FromRadio.node_info = field 4 */
export function encodeFromRadioNodeInfo(info: NodeInfo): Uint8Array {
  return lenField(4, encodeNodeInfo(info));
}

/** FromRadio.config_complete_id = field 7 (uint32) */
export function encodeFromRadioConfigComplete(id: number): Uint8Array {
  return varField(7, id);
}

/** FromRadio.rebooted = field 8 (bool, always true when sent) */
export function encodeFromRadioRebooted(): Uint8Array {
  return varField(8, 1);
}

/** FromRadio.channel = field 10 */
export function encodeFromRadioChannel(channel: Parameters<typeof encodeChannelMessage>[0]): Uint8Array {
  return lenField(10, encodeChannelMessage(channel));
}

/** FromRadio.metadata = field 13 */
export function encodeFromRadioMetadata(meta: Parameters<typeof encodeDeviceMetadata>[0]): Uint8Array {
  return lenField(13, encodeDeviceMetadata(meta));
}
