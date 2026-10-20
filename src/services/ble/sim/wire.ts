// Minimal protobuf wire helpers for the firmware-sim harness. The harness has
// to move MeshPackets between simulated radios byte-for-byte (so no field the
// firmware set is lost), which the app codec doesn't need and shouldn't grow.

export interface RawField {
  field: number;
  wireType: number;
  /** Value bytes (varint / fixed bytes / length-delimited body). */
  value: Uint8Array;
}

export function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    // Multiply instead of shifting: JS bitwise ops truncate to 32 bits.
    result += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
  }
  throw new Error('truncated varint');
}

export function writeVarint(value: number): Uint8Array {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return new Uint8Array(out);
}

export function splitFields(buf: Uint8Array): RawField[] {
  const fields: RawField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, afterKey] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wireType = key & 7;
    pos = afterKey;
    let end: number;
    let start = pos;
    if (wireType === 0) {
      [, end] = readVarint(buf, pos);
    } else if (wireType === 1) {
      end = pos + 8;
    } else if (wireType === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      start = afterLen;
      end = afterLen + len;
    } else if (wireType === 5) {
      end = pos + 4;
    } else {
      throw new Error(`unsupported wire type ${wireType}`);
    }
    if (end > buf.length) throw new Error('truncated field');
    fields.push({ field, wireType, value: buf.subarray(start, end) });
    pos = end;
  }
  return fields;
}

export function getField(buf: Uint8Array, field: number): RawField | undefined {
  return splitFields(buf).find(f => f.field === field);
}

export function varintOf(f: RawField | undefined): number | undefined {
  return f ? readVarint(f.value, 0)[0] : undefined;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function lenField(field: number, body: Uint8Array): Uint8Array {
  return concat(writeVarint(field * 8 + 2), writeVarint(body.length), body);
}

export function varField(field: number, value: number): Uint8Array {
  return concat(writeVarint(field * 8), writeVarint(value));
}

export function floatField(field: number, value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, value, true);
  return concat(writeVarint(field * 8 + 5), b);
}

export function fixed32Field(field: number, value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, true);
  return concat(writeVarint(field * 8 + 5), b);
}

export function fixed32Of(f: RawField | undefined): number | undefined {
  return f ? new DataView(f.value.buffer, f.value.byteOffset, 4).getUint32(0, true) : undefined;
}
