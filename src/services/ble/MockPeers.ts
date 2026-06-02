import type { MockFirmware } from './MockFirmware';
import type { NodeInfo } from '../../types/mesh';
import { PortNum } from '../../types/mesh';

// ── Virtual peer ─────────────────────────────────────────────────────────────
//
// A VirtualPeer represents another T-Echo on the mesh that our mock-connected
// device "hears." It periodically broadcasts NodeInfo (keeping itself visible
// in our crew list) and can be scripted to send messages or move position.
//
// Peers push frames into the firmware's output buffer via injectNodeInfo and
// injectMeshPacket — the firmware in turn encodes them as real FromRadio
// bytes, and our app's decoder handles them exactly as if they'd arrived
// from real LoRa hardware.

export interface VirtualPeerOptions {
  nodeId: number;
  longName: string;
  shortName: string;
  lat: number;
  lng: number;
  battery: number;
  snr: number;
  /** Color broadcast (MF:K:#hex) sent once on entry, optional. */
  color?: string;
}

export class VirtualPeer {
  readonly nodeId: number;
  readonly id: string;
  longName: string;
  shortName: string;
  lat: number;
  lng: number;
  battery: number;
  snr: number;
  color?: string;
  private timers: ReturnType<typeof setInterval>[] = [];
  private timeouts: ReturnType<typeof setTimeout>[] = [];

  constructor(opts: VirtualPeerOptions) {
    this.nodeId = opts.nodeId;
    this.id = '!' + opts.nodeId.toString(16).padStart(8, '0');
    this.longName = opts.longName;
    this.shortName = opts.shortName;
    this.lat = opts.lat;
    this.lng = opts.lng;
    this.battery = opts.battery;
    this.snr = opts.snr;
    this.color = opts.color;
  }

  /** Build the NodeInfo object this peer would broadcast right now. */
  snapshotNodeInfo(ageSecondsBackdated = 0): NodeInfo {
    const now = Math.floor(Date.now() / 1000);
    return {
      num: this.nodeId,
      user: { id: this.id, longName: this.longName, shortName: this.shortName },
      position: {
        latitudeI: Math.round(this.lat * 1e7),
        longitudeI: Math.round(this.lng * 1e7),
        time: now - ageSecondsBackdated,
      },
      snr: this.snr,
      lastHeard: now - ageSecondsBackdated,
      deviceMetrics: { batteryLevel: this.battery },
    };
  }

  /**
   * Start periodic NodeInfo broadcasts at interval ms. Keeps the peer
   * "online" in the app's isOnline threshold. Also drifts position slightly
   * on each broadcast to exercise map-update logic.
   */
  startBroadcasting(firmware: MockFirmware, intervalMs: number) {
    const tick = () => {
      this.lat += (Math.random() - 0.5) * 0.0002;
      this.lng += (Math.random() - 0.5) * 0.0002;
      firmware.injectNodeInfo(this.snapshotNodeInfo());
    };
    const t = setInterval(tick, intervalMs);
    this.timers.push(t);
  }

  /** Send a text payload as this peer. */
  sendText(firmware: MockFirmware, text: string) {
    firmware.injectMeshPacket({
      from: this.nodeId,
      to: 0xffffffff,
      channel: 0,
      decoded: {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode(text),
      },
      id: Math.floor(Math.random() * 0xffffffff),
      rxTime: Math.floor(Date.now() / 1000),
      rxSnr: this.snr,
    });
  }

  /** Schedule a one-shot event (message, NodeInfo, etc.) after delayMs. */
  scheduleOnce(fn: () => void, delayMs: number) {
    const t = setTimeout(fn, delayMs);
    this.timeouts.push(t);
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.timeouts.forEach(clearTimeout);
    this.timeouts = [];
  }
}

// ── Scenes ──────────────────────────────────────────────────────────────────

/** The original Coachella 6-peer scene. Default scenario for mock connect. */
export const COACHELLA_SCENE: VirtualPeerOptions[] = [
  { nodeId: 0x1a2b3c, longName: 'Alex Rivera',  shortName: 'Alex', lat: 33.6803, lng: -116.2378, battery: 82, snr: 10.5, color: '#e91e63' },
  { nodeId: 0x2b3c4d, longName: 'Sam Chen',     shortName: 'Sam',  lat: 33.6810, lng: -116.2365, battery: 45, snr:  6.2, color: '#2196f3' },
  { nodeId: 0x3c4d5e, longName: 'Jordan Park',  shortName: 'Jord', lat: 33.6798, lng: -116.2355, battery: 11, snr: -2.0, color: '#00bcd4' },
  { nodeId: 0x4d5e6f, longName: 'Mia Santos',   shortName: 'Mia',  lat: 33.6795, lng: -116.2368, battery: 67, snr:  8.0, color: '#8bc34a' },
  { nodeId: 0x5e6f80, longName: 'Kai Thompson', shortName: 'Kai',  lat: 33.6815, lng: -116.2345, battery: 93, snr: 12.0, color: '#9c27b0' },
  { nodeId: 0x6f8091, longName: 'Priya Sharma', shortName: 'Priy', lat: 33.6790, lng: -116.2380, battery: 34, snr:  1.5, color: '#ff5252' },
];

/** Scripted inbound messages for the COACHELLA_SCENE (per-peer text timeline). */
export const COACHELLA_MESSAGES: Array<{ nodeId: number; text: string; delay: number }> = [
  { nodeId: 0x1a2b3c, text: 'yo where you at?',                                       delay:  4000 },
  { nodeId: 0x2b3c4d, text: 'MF:H:main',                                              delay:  8000 },
  { nodeId: 0x3c4d5e, text: 'meet me at the Do LaB?',                                 delay: 14000 },
  { nodeId: 0x4d5e6f, text: 'MF:R:33.6800,-116.2370:by the art walk',                 delay: 20000 },
  { nodeId: 0x5e6f80, text: 'sahara tent is going off rn',                            delay: 26000 },
  { nodeId: 0x1a2b3c, text: 'MF:T:33.6808,-116.2360:Water Station',                   delay: 30000 },
  { nodeId: 0x6f8091, text: 'someone grab water pls',                                 delay: 38000 },
  { nodeId: 0x2b3c4d, text: 'this set is incredible',                                 delay: 45000 },
  { nodeId: 0x3c4d5e, text: "MF:M:21:00|sahara|Let's link up!",                       delay: 55000 },
  { nodeId: 0x5e6f80, text: 'heading to yuma in 10',                                  delay: 65000 },
];

// ── Helpers for scenario construction ───────────────────────────────────────

/** Seed firmware.nodeDB with the scene's peers (static entries before drain). */
export function seedNodeDBFromScene(
  firmware: MockFirmware,
  scene: VirtualPeerOptions[],
  ageSecondsBackdated = 30,
) {
  for (const opts of scene) {
    const peer = new VirtualPeer(opts);
    firmware.nodeDB.set(peer.nodeId, peer.snapshotNodeInfo(ageSecondsBackdated));
  }
}

/**
 * Start all peers broadcasting + inject the scripted message timeline.
 * Returns the created peer instances so a caller can stop() them later.
 */
export function startCoachellaScene(firmware: MockFirmware): VirtualPeer[] {
  const peers = COACHELLA_SCENE.map(opts => new VirtualPeer(opts));

  for (const peer of peers) {
    // Periodic broadcasts: 10-25s random intervals per peer.
    peer.startBroadcasting(firmware, 10000 + Math.random() * 15000);
    // Color intro messages (MF:K) sent ~1s after connect.
    if (peer.color) {
      peer.scheduleOnce(() => peer.sendText(firmware, `MF:K:${peer.color}`), 1000);
    }
  }

  for (const msg of COACHELLA_MESSAGES) {
    const peer = peers.find(p => p.nodeId === msg.nodeId);
    if (!peer) continue;
    peer.scheduleOnce(() => peer.sendText(firmware, msg.text), msg.delay);
  }

  return peers;
}
