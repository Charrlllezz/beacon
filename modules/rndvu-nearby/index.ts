import { NativeModule, requireOptionalNativeModule } from 'expo';

// lowPower: Low Power Mode or under 20% battery, so no UWB (GPS only).
export type RangeState = 'searching' | 'ranging' | 'lost' | 'ended' | 'suspended' | 'unsupported' | 'lowPower' | 'error';

export interface RangeEvent {
  state: RangeState;
  distance?: number;   // metres
  azimuth?: number;    // radians, 0 = straight ahead of the phone, + = right
  converged?: boolean; // camera-assisted direction is ready
  message?: string;
}

export interface Capabilities {
  distance: boolean;
  direction: boolean;
  cameraAssist: boolean;
}

type Events = { onRange: (event: RangeEvent) => void };

declare class RndvuNearbyNative extends NativeModule<Events> {
  capabilities(): Capabilities;
  start(myNodeId: number, peerNodeId: number, activityTitle: string | null, role: string | null): Promise<void>;
  stop(): Promise<void>;
}

// Optional: builds before this module (build 25), tests, and phones without
// it get null and the arrow stays on GPS.
const native = requireOptionalNativeModule<RndvuNearbyNative>('RndvuNearby');

export function capabilities(): Capabilities | null {
  try {
    return native?.capabilities() ?? null;
  } catch {
    return null;
  }
}

export interface LiveActivity {
  title: string;               // "Ash is finding you" / "Finding Sam"
  role: 'finder' | 'helper';
}

/**
 * Start precise finding with one crew member. Both phones have to be finding
 * each other. With `activity`, a Live Activity shows the distance on the lock
 * screen and (iOS 18.4+) keeps UWB going with the phone locked. Stops by
 * itself after 10 minutes. Returns an unsubscribe-and-stop function, or null
 * if this phone can't do it.
 */
export function startPreciseFind(
  myNodeId: number,
  peerNodeId: number,
  onRange: (event: RangeEvent) => void,
  activity?: LiveActivity,
): (() => void) | null {
  if (!native || !capabilities()?.distance) return null;
  const sub = native.addListener('onRange', onRange);
  native.start(myNodeId, peerNodeId, activity?.title ?? null, activity?.role ?? null)
    .catch(() => onRange({ state: 'error' }));
  return () => {
    sub.remove();
    native.stop().catch(() => {});
  };
}
