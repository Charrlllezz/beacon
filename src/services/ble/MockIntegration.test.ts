import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockFirmware } from './MockFirmware';
import { VirtualPeer, COACHELLA_SCENE, seedNodeDBFromScene } from './MockPeers';
import { applyScenario } from './MockScenarios';
import { decodeFromRadio, encodeSetOwner, RNDVU_CHANNEL_NAME } from './MeshtasticCodec';
import type { FromRadio } from '../../types/mesh';

// Test harness that mimics MockBleManager's drain loop without the real
// timers or BLE-simulation delays. Pulls every queued frame, decodes each
// through the real decoder, and returns the shaped FromRadio events the
// app would have received.
function drainAll(fw: MockFirmware): FromRadio[] {
  const out: FromRadio[] = [];
  let frame = fw.getNextFromRadioFrame();
  while (frame) {
    out.push(decodeFromRadio(frame));
    frame = fw.getNextFromRadioFrame();
  }
  return out;
}

function encodeWantConfig(id: number): Uint8Array {
  // ToRadio.want_config_id = field 3 varint. Tag = (3<<3)|0 = 24.
  const bytes: number[] = [24];
  let v = id >>> 0;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

describe('integration: mock firmware + scenarios + decoder end-to-end', () => {
  test('Coachella scenario drain produces crew-populating events', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    seedNodeDBFromScene(fw, COACHELLA_SCENE, 30);
    fw.handleToRadio(encodeWantConfig(42));
    const events = drainAll(fw);

    // myInfo — exactly one, with nodedbCount = peers + self.
    const myInfoEvents = events.filter(e => e.myInfo);
    expect(myInfoEvents).toHaveLength(1);
    expect(myInfoEvents[0].myInfo!.myNodeNum).toBe(0x5e6f7a);
    expect(myInfoEvents[0].myInfo!.nodedbCount).toBe(COACHELLA_SCENE.length + 1);

    // NodeInfo events — one per peer + self.
    const nodeInfoEvents = events.filter(e => e.nodeInfo);
    expect(nodeInfoEvents.length).toBe(COACHELLA_SCENE.length + 1);
    // Every peer from the scene is represented by exactly one NodeInfo event.
    for (const peer of COACHELLA_SCENE) {
      const found = nodeInfoEvents.find(e => e.nodeInfo!.num === peer.nodeId);
      expect(found).toBeDefined();
      expect(found!.nodeInfo!.user?.longName).toBe(peer.longName);
      expect(found!.nodeInfo!.user?.shortName).toBe(peer.shortName);
      // Position was backdated 30s; just verify both coords are present.
      expect(found!.nodeInfo!.position?.latitudeI).toBeCloseTo(peer.lat * 1e7, -2);
    }

    // Channel event carries the RNDVU name from the pre-provisioned state.
    const channelEvent = events.find(e => e.channel);
    expect(channelEvent?.channel?.settings?.name).toBe(RNDVU_CHANNEL_NAME);
    expect(channelEvent?.channel?.role).toBe(1); // PRIMARY

    // Metadata event carries firmware version + hwModel for Debug screen.
    const metaEvent = events.find(e => e.metadata);
    expect(metaEvent?.metadata?.firmwareVersion).toContain('2.5');
    expect(metaEvent?.metadata?.hwModel).toBe(7); // T_ECHO

    // configCompleteId closes the drain.
    const completeEvent = events.find(e => e.configCompleteId !== undefined);
    expect(completeEvent?.configCompleteId).toBe(42);
  });

  test('peer injects a text message — decodes back with correct sender + payload', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    drainAll(fw); // flush any initial state
    const peer = new VirtualPeer(COACHELLA_SCENE[0]);
    peer.sendText(fw, 'yo where you at?');
    const events = drainAll(fw);
    expect(events).toHaveLength(1);
    const pkt = events[0].packet!;
    expect(pkt.from).toBe(peer.nodeId);
    expect(pkt.to).toBe(0xffffffff); // broadcast
    expect(pkt.channel).toBe(0);
    expect(pkt.rxSnr).toBeCloseTo(peer.snr, 1);
    expect(pkt.decoded!.portnum).toBe(1); // TEXT_MESSAGE_APP
    const text = new TextDecoder().decode(pkt.decoded!.payload);
    expect(text).toBe('yo where you at?');
  });

  test('setOwner → firmware state updates → NodeInfo emitted with new name', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    drainAll(fw);
    fw.handleToRadio(encodeSetOwner(0x5e6f7a, 'Charles K', 'CKF'));
    const events = drainAll(fw);
    expect(fw.owner.longName).toBe('Charles K');
    expect(fw.owner.shortName).toBe('CKF');
    // The self NodeInfo rebroadcast landed in the output stream.
    const self = events.find(e => e.nodeInfo?.num === 0x5e6f7a);
    expect(self?.nodeInfo?.user?.longName).toBe('Charles K');
    expect(self?.nodeInfo?.user?.shortName).toBe('CKF');
  });
});

describe('integration: scenarios produce expected shapes', () => {
  test('solo scenario drains with zero peer NodeInfos', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    applyScenario('solo', fw);
    fw.handleToRadio(encodeWantConfig(1));
    const events = drainAll(fw);
    const peerEvents = events.filter(e => e.nodeInfo && e.nodeInfo.num !== 0x5e6f7a);
    expect(peerEvents).toHaveLength(0);
  });

  test('misprovisioned scenario emits a Channel with name != RNDVU', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    applyScenario('misprovisioned', fw);
    fw.handleToRadio(encodeWantConfig(1));
    const events = drainAll(fw);
    const channelEvent = events.find(e => e.channel);
    expect(channelEvent).toBeDefined();
    expect(channelEvent!.channel!.settings?.name).not.toBe(RNDVU_CHANNEL_NAME);
    expect(channelEvent!.channel!.settings?.name).toBe('RNDVU2');
  });

  test('stale-peer scenario emits a peer whose lastHeard is >30m old', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    applyScenario('stale-peer', fw);
    fw.handleToRadio(encodeWantConfig(1));
    const events = drainAll(fw);
    const peerEvent = events.find(e => e.nodeInfo && e.nodeInfo.num !== 0x5e6f7a);
    expect(peerEvent).toBeDefined();
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - (peerEvent!.nodeInfo!.lastHeard ?? 0);
    expect(ageSec).toBeGreaterThan(30 * 60); // >30 minutes
  });

  test('large-crew scenario seeds 25 peers into nodedb', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    applyScenario('large-crew', fw);
    fw.handleToRadio(encodeWantConfig(1));
    const events = drainAll(fw);
    const peerEvents = events.filter(e => e.nodeInfo && e.nodeInfo.num !== 0x5e6f7a);
    expect(peerEvents.length).toBe(25);
  });
});

describe('integration: timed scenario behavior', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('peer-joins-late: second peer appears 45s after connect', () => {
    const fw = new MockFirmware({ myNodeNum: 0x5e6f7a });
    applyScenario('peer-joins-late', fw);
    fw.handleToRadio(encodeWantConfig(1));

    // Drain the initial config — should include only the first peer.
    const initialEvents = drainAll(fw);
    const initialPeers = initialEvents.filter(e => e.nodeInfo && e.nodeInfo.num !== 0x5e6f7a);
    expect(initialPeers.length).toBe(1);

    // Advance 45s. Latecomer's scheduleOnce fires: starts broadcasting +
    // sends a text. That produces at least one NodeInfo + one packet event.
    vi.advanceTimersByTime(45_000);
    const lateEvents = drainAll(fw);
    const lateTexts = lateEvents.filter(e =>
      e.packet?.decoded?.portnum === 1 /* TEXT */,
    );
    expect(lateTexts.length).toBeGreaterThanOrEqual(1);
    const text = new TextDecoder().decode(lateTexts[0].packet!.decoded!.payload);
    expect(text).toContain('just plugged my T-Echo');
  });
});
