import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MockFirmware } from './MockFirmware';
import {
  VirtualPeer,
  COACHELLA_SCENE,
  COACHELLA_MESSAGES,
  seedNodeDBFromScene,
  startCoachellaScene,
} from './MockPeers';

export type ScenarioName =
  | 'normal'
  | 'solo'
  | 'flaky-ble'
  | 'large-crew'
  | 'peer-joins-late'
  | 'stale-peer'
  | 'misprovisioned';

export const SCENARIO_STORAGE_KEY = 'rndvu_mock_scenario';
export const DEFAULT_SCENARIO: ScenarioName = 'normal';

export const SCENARIO_LABELS: Record<ScenarioName, string> = {
  'normal':           'Normal (6 peers Coachella scene)',
  'solo':             'Solo (no peers, empty crew)',
  'flaky-ble':        'Flaky BLE (random drops)',
  'large-crew':       'Large Crew (25 peers)',
  'peer-joins-late':  'Peer Joins Late (1 at start, new after 45s)',
  'stale-peer':       'Stale Peer (1 peer, last heard 45m ago)',
  'misprovisioned':   'Misprovisioned (wrong channel name)',
};

/**
 * Scenario execution result. `peers` is returned so the transport layer can
 * .stop() them on disconnect or scenario switch. `flakyTimer` lets the
 * flaky-ble scenario schedule periodic drops via the transport.
 */
export interface ScenarioContext {
  peers: VirtualPeer[];
  /** Optional: scenario may request periodic BLE drops from transport. */
  flakyDropIntervalMs?: number;
}

export async function loadSavedScenario(): Promise<ScenarioName> {
  try {
    const raw = await AsyncStorage.getItem(SCENARIO_STORAGE_KEY);
    if (raw && (raw as ScenarioName) in SCENARIO_LABELS) {
      return raw as ScenarioName;
    }
  } catch {}
  return DEFAULT_SCENARIO;
}

export async function saveScenario(name: ScenarioName): Promise<void> {
  try {
    await AsyncStorage.setItem(SCENARIO_STORAGE_KEY, name);
  } catch {}
}

/**
 * Apply a scenario to a fresh firmware instance. Should be called once per
 * mock connect, after the firmware has been constructed but before the first
 * config drain (so pre-seeded nodeDB lands in the drain).
 */
export function applyScenario(name: ScenarioName, firmware: MockFirmware): ScenarioContext {
  switch (name) {
    case 'solo':           return applySolo(firmware);
    case 'flaky-ble':      return applyFlakyBle(firmware);
    case 'large-crew':     return applyLargeCrew(firmware);
    case 'peer-joins-late':return applyPeerJoinsLate(firmware);
    case 'stale-peer':     return applyStalePeer(firmware);
    case 'misprovisioned': return applyMisprovisioned(firmware);
    case 'normal':
    default:               return applyNormal(firmware);
  }
}

// ── Individual scenarios ────────────────────────────────────────────────────

function applyNormal(firmware: MockFirmware): ScenarioContext {
  seedNodeDBFromScene(firmware, COACHELLA_SCENE, 30);
  const peers = startCoachellaScene(firmware);
  return { peers };
}

function applySolo(_firmware: MockFirmware): ScenarioContext {
  // Empty nodeDB, no peers broadcasting. Tests empty-crew states, onboarding
  // UX, self rendering.
  return { peers: [] };
}

function applyFlakyBle(firmware: MockFirmware): ScenarioContext {
  // Normal crew but the transport will drop BLE every 45-90s to exercise
  // reconnect + send-status-indicator paths.
  seedNodeDBFromScene(firmware, COACHELLA_SCENE.slice(0, 3), 30);
  const peers = startCoachellaScene(firmware);
  return { peers, flakyDropIntervalMs: 60000 };
}

function applyLargeCrew(firmware: MockFirmware): ScenarioContext {
  // 25 synthetic peers. Tests crew-list virtualization, sort perf, stale
  // aging, search. Generated rather than curated.
  const peers: VirtualPeer[] = [];
  for (let i = 0; i < 25; i++) {
    const nodeId = 0xaa000000 | (i + 1);
    const peer = new VirtualPeer({
      nodeId,
      longName: `Tester ${i + 1}`,
      shortName: `T${i + 1}`.slice(0, 4),
      lat: 33.6800 + (Math.random() - 0.5) * 0.004,
      lng: -116.2370 + (Math.random() - 0.5) * 0.004,
      battery: 30 + Math.floor(Math.random() * 70),
      snr: Math.random() * 15 - 2,
    });
    firmware.nodeDB.set(peer.nodeId, peer.snapshotNodeInfo(30));
    // Stagger the broadcast intervals so they don't all fire at once.
    peer.startBroadcasting(firmware, 15000 + Math.random() * 30000);
    peers.push(peer);
  }
  return { peers };
}

function applyPeerJoinsLate(firmware: MockFirmware): ScenarioContext {
  // One peer at connect, another appears 45s in. Tests NodeInfo handling
  // AFTER drain — the harder path where the crewStore must upsert instead
  // of rehydrate.
  const earlyOpts = COACHELLA_SCENE[0];
  const earlyPeer = new VirtualPeer(earlyOpts);
  firmware.nodeDB.set(earlyPeer.nodeId, earlyPeer.snapshotNodeInfo(30));
  earlyPeer.startBroadcasting(firmware, 20000);

  const latecomerOpts = COACHELLA_SCENE[1];
  const latecomer = new VirtualPeer(latecomerOpts);
  latecomer.scheduleOnce(() => {
    // Note: only start broadcasting AFTER the join, so it doesn't appear in
    // the initial drain.
    latecomer.startBroadcasting(firmware, 15000);
    latecomer.sendText(firmware, `Hey, just plugged my T-Echo in`);
  }, 45000);

  return { peers: [earlyPeer, latecomer] };
}

function applyStalePeer(firmware: MockFirmware): ScenarioContext {
  // Single peer with lastHeard 45 minutes in the past. No ongoing broadcasts.
  // Exercises the offline-visual + isOnline threshold + stale-aging logic.
  const opts = COACHELLA_SCENE[0];
  const peer = new VirtualPeer(opts);
  const staleInfo = peer.snapshotNodeInfo(45 * 60); // 45 min ago
  firmware.nodeDB.set(peer.nodeId, staleInfo);
  // Intentionally don't startBroadcasting — peer stays stale.
  return { peers: [peer] };
}

function applyMisprovisioned(firmware: MockFirmware): ScenarioContext {
  // Primary channel name is wrong — what a tester who imported a different
  // QR code would look like. Debug screen should flag the Channel row with
  // a red dot (name !== 'RNDVU').
  firmware.primaryChannel = { index: 0, name: 'RNDVU2', role: 1 };
  seedNodeDBFromScene(firmware, COACHELLA_SCENE.slice(0, 3), 30);
  const peers = startCoachellaScene(firmware);
  // Send one introductory message so the chat isn't empty.
  peers[0]?.scheduleOnce(
    () => peers[0]?.sendText(firmware, 'anyone else on this channel?'),
    3000,
  );
  // Use a scripted message to distinguish scenarios in manual testing.
  COACHELLA_MESSAGES.length > 0 && void 0; // keep the import used
  return { peers };
}
