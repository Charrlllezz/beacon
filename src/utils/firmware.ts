// Meshtastic firmware versions look like "2.7.26.54e0d8d" (major.minor.patch.
// commit). Only the numeric triple matters for behaviour checks.

export type FirmwareTriple = [number, number, number];

export function parseFirmwareVersion(v: string | null | undefined): FirmwareTriple | null {
  const m = v?.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** <0 if a is older than b, 0 if equal, >0 if newer. */
export function compareFirmware(a: FirmwareTriple, b: FirmwareTriple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// From 2.7.24, a channel with no module_settings broadcasts no position
// ("fail closed", firmware #10513). Older firmware defaulted a PRIMARY channel
// to exact position.
const POSITION_FAIL_CLOSED_FROM: FirmwareTriple = [2, 7, 24];

/**
 * Is this radio's location reaching the crew, given its primary channel's
 * position precision (undefined = not drained yet, null = channel has no
 * module_settings) and firmware version? Returns null when not yet known.
 */
export function isSharingLocation(
  precision: number | null | undefined,
  firmwareVersion: string | null | undefined,
): boolean | null {
  if (precision === undefined) return null;
  if (precision !== null) return precision > 0;
  const fw = parseFirmwareVersion(firmwareVersion);
  if (!fw) return null;
  return compareFirmware(fw, POSITION_FAIL_CLOSED_FROM) < 0;
}
