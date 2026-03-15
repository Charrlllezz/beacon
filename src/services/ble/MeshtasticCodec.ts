import type { MeshPacket, FromRadio, Position, NodeInfo, Telemetry } from '../../types/mesh';
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
      hasGps: f.has(2) ? varintVal(f.get(2)![0]) !== 0 : undefined,
    };
  }
  if (fields.has(4)) result.nodeInfo = decodeNodeInfo(fields.get(4)![0]);
  if (fields.has(6)) result.configCompleteId = varintVal(fields.get(6)![0]);
  if (fields.has(7)) result.rebooted = varintVal(fields.get(7)![0]) !== 0;

  return result;
}

function decodeMeshPacket(bytes: Uint8Array): MeshPacket {
  const fields = parseFields(bytes);
  const packet: MeshPacket = { from: 0, to: 0, channel: 0 };

  if (fields.has(1)) packet.from = varintVal(fields.get(1)![0]);
  if (fields.has(2)) packet.to = varintVal(fields.get(2)![0]);
  if (fields.has(3)) packet.channel = varintVal(fields.get(3)![0]);
  if (fields.has(6)) {
    const df = parseFields(fields.get(6)![0]);
    packet.decoded = {
      portnum: df.has(1) ? varintVal(df.get(1)![0]) : 0,
      payload: df.has(2) ? df.get(2)![0] : new Uint8Array(),
    };
  }
  if (fields.has(9)) packet.rxTime = varintVal(fields.get(9)![0]);
  if (fields.has(10)) packet.id = varintVal(fields.get(10)![0]);

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
      latitudeI: pf.has(1) ? varintVal(pf.get(1)![0]) : 0,
      longitudeI: pf.has(2) ? varintVal(pf.get(2)![0]) : 0,
      altitude: pf.has(3) ? varintVal(pf.get(3)![0]) : undefined,
      time: pf.has(4) ? varintVal(pf.get(4)![0]) : undefined,
    };
  }
  if (fields.has(5)) info.lastHeard = varintVal(fields.get(5)![0]);
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
    latitudeI: fields.has(1) ? varintVal(fields.get(1)![0]) : 0,
    longitudeI: fields.has(2) ? varintVal(fields.get(2)![0]) : 0,
    altitude: fields.has(3) ? varintVal(fields.get(3)![0]) : undefined,
    time: fields.has(4) ? varintVal(fields.get(4)![0]) : undefined,
  };
}

export function decodeTelemetry(payload: Uint8Array): Telemetry {
  const fields = parseFields(payload);
  const result: Telemetry = { time: Math.floor(Date.now() / 1000) };
  if (fields.has(1)) result.time = varintVal(fields.get(1)![0]);
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

export function encodeToRadio(to: number, text: string, myNodeNum: number, channelIndex = 0): Uint8Array {
  const textBytes = new TextEncoder().encode(text);
  const dataPayload = concat(varField(1, PortNum.TEXT_MESSAGE_APP), lenField(2, textBytes));
  const meshPacket = concat(
    varField(1, myNodeNum),
    varField(2, to),
    varField(3, channelIndex),
    varField(5, 1),
    lenField(6, dataPayload),
  );
  return lenField(1, meshPacket);
}

export function encodeWantConfig(configId: number): Uint8Array {
  return varField(3, configId);
}
