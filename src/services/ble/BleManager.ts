// ── BLE transport selector ──────────────────────────────────────────────────
//
// Flip USE_MOCK to `true` to run against the high-fidelity in-process
// Meshtastic simulator (MockFirmware + VirtualPeer). Mock mode exercises the
// real wire-format decoder end-to-end — frames produced by MockFirmware are
// encoded with the same helpers we ship in production, and the app decodes
// them via decodeFromRadio exactly as it would bytes from a real T-Echo.
//
// Use mock when:
//   - Iterating UI/UX without a physical device (iOS simulator, faster loop)
//   - Testing scenarios impossible to trigger on hardware (scale, timing)
//   - Ruling out app bugs when something breaks on real hardware
//
// Required toggle to rebuild (mock vs real is a compile-time selection).
export const USE_MOCK = false;

import { realBleManager, type PacketCallback, type StatusCallback } from './RealBleManager';
import { mockBleManager } from './MockBleManager';

// TypeScript will enforce interface parity between the two implementations at
// this line. If either one diverges, this conditional picks up a type error.
export const bleService = USE_MOCK ? mockBleManager : realBleManager;

export type { PacketCallback, StatusCallback };
