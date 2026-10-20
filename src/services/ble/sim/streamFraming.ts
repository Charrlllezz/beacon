// Meshtastic stream framing, used by the firmware's TCP (and serial) API:
//   0x94 0xC3 <len MSB> <len LSB> <protobuf bytes>
// Over BLE each characteristic read/write is already one message, so the app
// never needs this; the sim harness talks to meshtasticd over TCP and does.

export const START1 = 0x94;
export const START2 = 0xc3;
export const MAX_FRAME = 512;

export function frame(payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_FRAME) throw new Error(`frame too large: ${payload.length}`);
  const out = new Uint8Array(payload.length + 4);
  out[0] = START1;
  out[1] = START2;
  out[2] = payload.length >> 8;
  out[3] = payload.length & 0xff;
  out.set(payload, 4);
  return out;
}

/**
 * Incremental parser. Bytes outside a frame (firmware debug text, if the log
 * shares the stream) are skipped, as the official clients do.
 */
export class FrameParser {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const frames: Uint8Array[] = [];
    let pos = 0;
    while (true) {
      // Resync on the two start bytes.
      while (pos < this.buf.length && this.buf[pos] !== START1) pos++;
      if (pos + 4 > this.buf.length) break;
      if (this.buf[pos + 1] !== START2) { pos++; continue; }
      const len = (this.buf[pos + 2] << 8) | this.buf[pos + 3];
      if (len > MAX_FRAME) { pos++; continue; } // corrupt header: skip it
      if (pos + 4 + len > this.buf.length) break;
      frames.push(this.buf.slice(pos + 4, pos + 4 + len));
      pos += 4 + len;
    }
    this.buf = this.buf.slice(pos);
    return frames;
  }
}
