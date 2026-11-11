// LoRa carries ~233 bytes of message, and an emoji is 4 bytes, so the chat
// limit has to be in bytes, not characters: a 200-character message of emoji
// is ~800 bytes and the radio drops it while the bubble shows ✓.
export const MAX_MESSAGE_BYTES = 200;

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Bytes left, or null while there's plenty of room (no counter needed). */
export function bytesLeft(text: string, warnBelow = 40): number | null {
  const left = MAX_MESSAGE_BYTES - utf8Length(text);
  return left < warnBelow ? left : null;
}
