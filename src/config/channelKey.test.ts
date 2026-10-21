import { describe, test, expect, vi } from 'vitest';
import { parseBuildKey, resolveChannelKey } from './channelKey';
import { RNDVU_CHANNEL_PSK } from '../services/ble/MeshtasticCodec';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe('parseBuildKey', () => {
  test('reads a 32-byte base64 key, standard or URL-safe, padded or not', () => {
    const std = b64(KEY);
    expect(parseBuildKey(std)).toEqual(KEY);
    expect(parseBuildKey(std.replace(/=+$/, ''))).toEqual(KEY);
    expect(parseBuildKey(std.replace(/\+/g, '-').replace(/\//g, '_'))).toEqual(KEY);
    expect(parseBuildKey(`  ${std}\n`)).toEqual(KEY);
  });

  test('rejects the wrong length, junk and an all-zero placeholder', () => {
    expect(parseBuildKey(b64(KEY.slice(0, 16)))).toBeNull();
    expect(parseBuildKey('not base64 at all!')).toBeNull();
    expect(parseBuildKey(b64(new Uint8Array(32)))).toBeNull();
    expect(parseBuildKey(undefined)).toBeNull();
  });
});

describe('resolveChannelKey', () => {
  test('a build key wins', () => {
    expect(resolveChannelKey(b64(KEY))).toEqual({ psk: KEY, source: 'build' });
  });

  test('no build key falls back to the Model 1 key', () => {
    expect(resolveChannelKey(undefined)).toEqual({ psk: RNDVU_CHANNEL_PSK, source: 'default' });
  });

  test('a malformed build key falls back too, but is reported', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveChannelKey('oops')).toEqual({ psk: RNDVU_CHANNEL_PSK, source: 'invalid' });
  });
});
