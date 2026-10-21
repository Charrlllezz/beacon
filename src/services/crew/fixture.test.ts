import { describe, test, expect } from 'vitest';
import { buildMeshtasticUrl, buildInviteUrl, crewIdFor } from './invite';

// Shared with tools/flash-fleet/test_flash_fleet.py: the flashing station
// builds the same ChannelSet in Python, so both must produce these exact
// strings for this key. Change both together.
export const FIXTURE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
export const FIXTURE_MESHTASTIC_URL =
  'https://meshtastic.org/e/#Ci0SIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fGgVSTkRWVToCCCASCggBEAA4AUADSAE';

describe('invite fixture (pinned for the Python flashing station)', () => {
  test('the Meshtastic link for the fixture key', () => {
    expect(buildMeshtasticUrl(FIXTURE_KEY)).toBe(FIXTURE_MESHTASTIC_URL);
  });
  test('the crew id the app shows matches what the flashing station logs', () => {
    expect(crewIdFor(FIXTURE_KEY)).toBe('0913ad');
  });
  test('the RNDVU invite carries the same ChannelSet', () => {
    expect(buildInviteUrl(FIXTURE_KEY, 'Order 1001')).toBe(
      `rndvu://join#v=1&cs=${FIXTURE_MESHTASTIC_URL.split('#')[1]}&n=Order%201001`,
    );
  });
});
