import { RNDVU_CHANNEL_PSK, pskFingerprint } from '../services/ble/MeshtasticCodec';

// The crew channel key this build writes to radios at pairing.
//
// The default (Model 1) key is compiled into a public repo, so anyone can read
// it. A build can carry its own key instead: EAS bakes the environment variable
// EXPO_PUBLIC_RNDVU_CHANNEL_PSK (32 bytes, base64) into the bundle, and the
// key is never committed. Countdown NYE uses this. Radios paired by a build
// with a different key can't read each other.
//
// A build without the variable falls back to the Model 1 key, so local and
// dev builds keep working. scripts/check-channel-key.js fails an EAS build
// whose variable is set but malformed.

export type ChannelKeySource = 'build' | 'default' | 'invalid';

export function parseBuildKey(value: string | undefined): Uint8Array | null {
  if (!value) return null;
  // Accept standard and URL-safe base64, with or without padding.
  const b64 = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  } catch {
    return null;
  }
  if (bin.length !== 32) return null;
  const key = Uint8Array.from(bin, c => c.charCodeAt(0));
  // An all-zero key is a placeholder, not a key.
  if (key.every(b => b === 0)) return null;
  return key;
}

export function resolveChannelKey(value: string | undefined): { psk: Uint8Array; source: ChannelKeySource } {
  if (!value) return { psk: RNDVU_CHANNEL_PSK, source: 'default' };
  const key = parseBuildKey(value);
  if (!key) {
    console.warn('EXPO_PUBLIC_RNDVU_CHANNEL_PSK is not a 32-byte base64 key; using the default key');
    return { psk: RNDVU_CHANNEL_PSK, source: 'invalid' };
  }
  return { psk: key, source: 'build' };
}

// Written literally so Expo inlines it at build time.
const resolved = resolveChannelKey(process.env.EXPO_PUBLIC_RNDVU_CHANNEL_PSK);

export const CREW_CHANNEL_PSK: Uint8Array = resolved.psk;
export const CREW_CHANNEL_KEY_SOURCE: ChannelKeySource = resolved.source;
// Matches what the Device sheet shows for the radio's key (channel drain).
export const CREW_CHANNEL_KEY_FINGERPRINT = pskFingerprint(CREW_CHANNEL_PSK);
