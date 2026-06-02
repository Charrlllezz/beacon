import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockFirmware } from './MockFirmware';
import {
  decodeFromRadio,
  encodeToRadio,
  encodeSetOwner,
  encodeSetChannel,
  encodeBeginEditSettings,
  encodeCommitEditSettings,
  encodeSetLoraConfig,
  encodeReboot,
  encodeFactoryReset,
} from './MeshtasticCodec';
import type { FromRadio } from '../../types/mesh';

// Helper: drain all queued frames out of the firmware and decode them back
// into FromRadio shapes. This is exactly what MockBleManager does at runtime
// — doing it in tests confirms the end-to-end byte path.
function drainAll(fw: MockFirmware): FromRadio[] {
  const out: FromRadio[] = [];
  let frame = fw.getNextFromRadioFrame();
  while (frame) {
    out.push(decodeFromRadio(frame));
    frame = fw.getNextFromRadioFrame();
  }
  return out;
}

// Build a ToRadio with just want_config_id set. (Codec's encodeWantConfig
// returns the field bytes directly — that's what firmware.handleToRadio
// expects as a full ToRadio payload.)
function encodeWantConfig(id: number): Uint8Array {
  const tag = 24; // (3<<3)|0
  const bytes: number[] = [tag];
  let v = id >>> 0;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

describe('MockFirmware config drain', () => {
  test('want_config_id triggers myInfo → selfNodeInfo → peerNodeInfos → channel → metadata → configCompleteId', () => {
    const fw = new MockFirmware({ myNodeNum: 0x12345678 });
    fw.nodeDB.set(0xaaaa1111, {
      num: 0xaaaa1111,
      user: { id: '!aaaa1111', longName: 'Peer One', shortName: 'P1' },
      lastHeard: 1700000000,
    });
    fw.handleToRadio(encodeWantConfig(42));
    const frames = drainAll(fw);

    // Order matters: myInfo first, then nodeInfos (self + peers), channel,
    // metadata, configCompleteId.
    expect(frames[0].myInfo?.myNodeNum).toBe(0x12345678);
    expect(frames[0].myInfo?.nodedbCount).toBe(2); // 1 peer + self

    // Self NodeInfo next.
    expect(frames[1].nodeInfo?.num).toBe(0x12345678);

    // Peer from nodeDB.
    expect(frames[2].nodeInfo?.num).toBe(0xaaaa1111);
    expect(frames[2].nodeInfo?.user?.longName).toBe('Peer One');

    // Channel (pre-provisioned = RNDVU).
    const channelFrame = frames.find(f => f.channel !== undefined);
    expect(channelFrame?.channel?.settings?.name).toBe('RNDVU');
    expect(channelFrame?.channel?.role).toBe(1);

    // Metadata with firmware version.
    const metaFrame = frames.find(f => f.metadata !== undefined);
    expect(metaFrame?.metadata?.firmwareVersion).toContain('2.5');
    expect(metaFrame?.metadata?.hwModel).toBe(7); // T_ECHO

    // configCompleteId last.
    const last = frames[frames.length - 1];
    expect(last.configCompleteId).toBe(42);
  });

  test('preProvisioned=false omits the Channel frame from drain (fresh factory state)', () => {
    const fw = new MockFirmware({ myNodeNum: 0x12345678, preProvisioned: false });
    fw.handleToRadio(encodeWantConfig(1));
    const frames = drainAll(fw);
    // No channel frame — role is DISABLED, firmware only emits PRIMARY.
    expect(frames.find(f => f.channel !== undefined)).toBeUndefined();
  });
});

describe('MockFirmware admin dispatch', () => {
  test('setOwner updates owner state AND re-broadcasts self NodeInfo with new name', () => {
    const fw = new MockFirmware({ myNodeNum: 0x11223344 });
    drainAll(fw); // flush initial state
    fw.handleToRadio(encodeSetOwner(0x11223344, 'Charles Apps', 'CKF'));
    const frames = drainAll(fw);
    expect(fw.owner.longName).toBe('Charles Apps');
    expect(fw.owner.shortName).toBe('CKF');
    // Self NodeInfo emitted with updated user fields.
    const nodeInfoFrame = frames.find(f => f.nodeInfo?.num === 0x11223344);
    expect(nodeInfoFrame?.nodeInfo?.user?.longName).toBe('Charles Apps');
    expect(nodeInfoFrame?.nodeInfo?.user?.shortName).toBe('CKF');
  });

  test('setChannel full transaction → primaryChannel updated, Channel frame emitted', () => {
    const fw = new MockFirmware({ myNodeNum: 0x11223344, preProvisioned: false });
    drainAll(fw);
    const psk = new Uint8Array(32).fill(0x42);
    fw.handleToRadio(encodeBeginEditSettings(0x11223344));
    fw.handleToRadio(encodeSetChannel(0x11223344, 0, 'RNDVU', psk, 1));
    fw.handleToRadio(encodeSetLoraConfig(0x11223344, 1));
    fw.handleToRadio(encodeCommitEditSettings(0x11223344));
    const frames = drainAll(fw);
    expect(fw.primaryChannel.name).toBe('RNDVU');
    expect(fw.primaryChannel.role).toBe(1);
    expect(fw.loraConfig.region).toBe(1);
    expect(fw.loraConfig.txEnabled).toBe(true);
    expect(fw.loraConfig.usePreset).toBe(true);
    const channelFrame = frames.find(f => f.channel !== undefined);
    expect(channelFrame?.channel?.settings?.name).toBe('RNDVU');
  });

  test('setLoraConfig partial write that would disable tx logs a warning', () => {
    const fw = new MockFirmware({ myNodeNum: 0x11223344 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Hand-build a partial LoRaConfig admin (region=US only, no tx_enabled).
    // This is the old broken encodeSetLoraConfig shape — the bug we fixed.
    const myNodeNum = 0x11223344;
    // LoRaConfig: only region=1 (field 7 varint = tag 0x38)
    const loraConfig = new Uint8Array([(7 << 3) | 0, 1]);
    // Config wrapper: lora=6 length-delimited (tag 0x32)
    const config = new Uint8Array([(6 << 3) | 2, loraConfig.length, ...loraConfig]);
    // AdminMessage.set_config = field 34 LEN. Tag = (34<<3)|2 = 274, which is
    // >127 and must be varint-encoded as [0x92, 0x02] (low 7 bits 0x12 with
    // continuation bit, then 0x02 as the high group). Getting this wrong
    // means the firmware sees a different field number and the check never
    // fires — which is exactly the kind of subtle wire-format bug we want
    // the mock to surface.
    const admin = new Uint8Array([0x92, 0x02, config.length, ...config]);
    // Data: portnum=ADMIN_APP(6) + payload=admin
    const data = new Uint8Array([
      (1 << 3) | 0, 6,
      (2 << 3) | 2, admin.length, ...admin,
    ]);
    const fromBytes = [
      myNodeNum & 0xff,
      (myNodeNum >>> 8) & 0xff,
      (myNodeNum >>> 16) & 0xff,
      (myNodeNum >>> 24) & 0xff,
    ];
    const packet = new Uint8Array([
      (1 << 3) | 5, ...fromBytes,  // from fixed32
      (2 << 3) | 5, ...fromBytes,  // to (self for admin) fixed32
      (3 << 3) | 0, 0,             // channel 0
      (4 << 3) | 2, data.length, ...data, // decoded
    ]);
    const toRadio = new Uint8Array([(1 << 3) | 2, packet.length, ...packet]);

    fw.handleToRadio(toRadio);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tx_enabled=false while region is set'),
    );
    warn.mockRestore();
  });
});

describe('MockFirmware factoryReset', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('wipes state and schedules reboot', () => {
    const fw = new MockFirmware({ myNodeNum: 0x11223344 });
    fw.owner = { id: '!11223344', longName: 'Taken', shortName: 'Tkn' };
    fw.nodeDB.set(0xbbbb0000, { num: 0xbbbb0000 });

    fw.handleToRadio(encodeFactoryReset(0x11223344));

    // State wiped immediately.
    expect(fw.owner.longName).toBe('');
    expect(fw.nodeDB.size).toBe(0);
    expect(fw.primaryChannel.role).toBe(0); // DISABLED
    expect(fw.loraConfig.txEnabled).toBe(false);

    // Advance past the 2s reboot delay.
    vi.advanceTimersByTime(2500);

    // Rebooted frame is now in the output.
    const frames = drainAll(fw);
    const rebootedFrame = frames.find(f => f.rebooted === true);
    expect(rebootedFrame).toBeDefined();
    expect(fw.rebootCount).toBe(1);
  });
});

describe('MockFirmware peer injection', () => {
  test('injectMeshPacket produces a decodable FromRadio.packet', () => {
    const fw = new MockFirmware({ myNodeNum: 0x12345678 });
    drainAll(fw);
    fw.injectMeshPacket({
      from: 0x99887766,
      to: 0xffffffff,
      channel: 0,
      decoded: { portnum: 1 /* TEXT */, payload: new TextEncoder().encode('hey') },
      id: 0xabcdef01,
      rxTime: 1700000000,
      rxSnr: 5.5,
    });
    const frames = drainAll(fw);
    expect(frames).toHaveLength(1);
    expect(frames[0].packet?.from).toBe(0x99887766);
    expect(frames[0].packet?.decoded?.portnum).toBe(1);
    const text = new TextDecoder().decode(frames[0].packet!.decoded!.payload);
    expect(text).toBe('hey');
  });

  test('injectNodeInfo adds to nodeDB AND enqueues decodable frame', () => {
    const fw = new MockFirmware({ myNodeNum: 0x12345678 });
    drainAll(fw);
    fw.injectNodeInfo({
      num: 0xaabbccdd,
      user: { id: '!aabbccdd', longName: 'New Peer', shortName: 'New' },
      lastHeard: 1700000000,
    });
    expect(fw.nodeDB.has(0xaabbccdd)).toBe(true);
    const frames = drainAll(fw);
    expect(frames[0].nodeInfo?.num).toBe(0xaabbccdd);
    expect(frames[0].nodeInfo?.user?.longName).toBe('New Peer');
  });
});

describe('MockFirmware handleToRadio', () => {
  test('outgoing non-admin MeshPacket (text broadcast) is ignored (no mesh propagation loop)', () => {
    const fw = new MockFirmware({ myNodeNum: 0x12345678 });
    drainAll(fw);
    // User sending a text from their phone — firmware in a real mesh would
    // transmit over LoRa. Our mock doesn't loop this back.
    fw.handleToRadio(encodeToRadio(0xffffffff, 'hello mesh', 0x12345678, 0));
    const frames = drainAll(fw);
    // No mesh loopback — user's own message doesn't come back as a FromRadio.
    expect(frames).toHaveLength(0);
  });

  test('heartbeat is silently consumed (no state change, no output)', () => {
    const fw = new MockFirmware({ myNodeNum: 0x12345678 });
    drainAll(fw);
    // Heartbeat = ToRadio field 7 length-delimited, empty body.
    const heartbeat = new Uint8Array([(7 << 3) | 2, 0]);
    fw.handleToRadio(heartbeat);
    const frames = drainAll(fw);
    expect(frames).toHaveLength(0);
  });
});
