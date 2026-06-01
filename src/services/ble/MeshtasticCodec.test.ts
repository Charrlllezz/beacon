import { describe, test, expect } from 'vitest';
import {
  encodeToRadio,
  encodeSetLoraConfig,
  encodeFactoryReset,
  decodeFromRadio,
  decodeTelemetry,
  decodePosition,
  encodeFromRadioMyInfo,
  encodeFromRadioNodeInfo,
  encodeFromRadioChannel,
  encodeFromRadioMetadata,
  encodeFromRadioConfigComplete,
  encodeFromRadioRebooted,
  encodeFromRadioPacket,
  RNDVU_CHANNEL_PSK,
} from './MeshtasticCodec';
import { PortNum } from '../../types/mesh';

// Helper: find a field tag byte in a protobuf wire payload. Tag byte for
// field N with wire type W is (N<<3)|W.
function tag(fieldNum: number, wireType: number): number {
  return (fieldNum << 3) | wireType;
}

// Helper: encode a varint uint32 to bytes (same logic as codec).
function varint(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v & 0x7f);
  return out;
}

function containsSequence(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Byte-level tag constants used by the tests.
const WIRE_VARINT = 0;
const WIRE_LEN = 2;
const WIRE_32BIT = 5;

describe('encodeToRadio', () => {
  test('broadcast (to=0xffffffff) does NOT set want_ack', () => {
    // want_ack is field 10 varint. Regression bug: want_ack=true on broadcast
    // triggers reliable-broadcast retransmit storm on a dense channel.
    const bytes = encodeToRadio(0xffffffff, 'hello', 0x1234, 0);
    // Tag byte for field 10 varint = 80.
    expect(containsSequence(bytes, [tag(10, WIRE_VARINT)])).toBe(false);
  });

  test('unicast (to=peer) does set want_ack=1', () => {
    const bytes = encodeToRadio(0xdeadbeef, 'hello', 0x1234, 0);
    // want_ack field 10 varint with value 1 → [80, 01]
    expect(containsSequence(bytes, [tag(10, WIRE_VARINT), 1])).toBe(true);
  });
});

describe('encodeSetLoraConfig', () => {
  test('writes complete config (use_preset, tx_enabled, region, hop_limit)', () => {
    // The regression this guards: writing only `region` let proto3 defaults
    // clobber tx_enabled=false and use_preset=false, disabling the radio.
    const bytes = encodeSetLoraConfig(0x12345678, 1 /* US */);
    // LoRaConfig.use_preset = field 1 varint, value 1
    expect(containsSequence(bytes, [tag(1, WIRE_VARINT), 1])).toBe(true);
    // LoRaConfig.region = field 7 varint, value 1 (US)
    expect(containsSequence(bytes, [tag(7, WIRE_VARINT), 1])).toBe(true);
    // LoRaConfig.hop_limit = field 8 varint, value 3
    expect(containsSequence(bytes, [tag(8, WIRE_VARINT), 3])).toBe(true);
    // LoRaConfig.tx_enabled = field 9 varint, value 1
    expect(containsSequence(bytes, [tag(9, WIRE_VARINT), 1])).toBe(true);
  });
});

describe('encodeFactoryReset', () => {
  test('sets AdminMessage.factory_reset_device (field 94) = 1', () => {
    const bytes = encodeFactoryReset(0x12345678);
    // field 94 varint → tag = (94<<3)|0 = 752 → varint-encoded as [0xf0, 0x05]
    const field94Tag = varint(tag(94, WIRE_VARINT));
    expect(containsSequence(bytes, [...field94Tag, 1])).toBe(true);
  });
});

describe('decodeFromRadio — MyNodeInfo', () => {
  test('parses my_node_num (field 1) and nodedb_count (field 15) from 2.5.x layout', () => {
    // Hand-craft a FromRadio with my_info (field 3, length-delimited)
    // containing my_node_num=0x0abbccdd and nodedb_count=7.
    const myInfoBody = Uint8Array.from([
      tag(1, WIRE_VARINT), ...varint(0x0abbccdd),
      tag(15, WIRE_VARINT), 7,
    ]);
    const fromRadio = Uint8Array.from([
      tag(3, WIRE_LEN), myInfoBody.length, ...myInfoBody,
    ]);
    const decoded = decodeFromRadio(fromRadio);
    expect(decoded.myInfo?.myNodeNum).toBe(0x0abbccdd);
    expect(decoded.myInfo?.nodedbCount).toBe(7);
  });
});

describe('decodeFromRadio — Channel', () => {
  test('parses primary channel name + index', () => {
    const name = 'RNDVU';
    const nameBytes = new TextEncoder().encode(name);
    const settings = Uint8Array.from([
      tag(3, WIRE_LEN), nameBytes.length, ...nameBytes,
    ]);
    const channelBody = Uint8Array.from([
      tag(1, WIRE_VARINT), 0,                       // index = 0
      tag(2, WIRE_LEN), settings.length, ...settings,
      tag(3, WIRE_VARINT), 1,                       // role = PRIMARY
    ]);
    const fromRadio = Uint8Array.from([
      tag(10, WIRE_LEN), channelBody.length, ...channelBody,
    ]);
    const decoded = decodeFromRadio(fromRadio);
    expect(decoded.channel?.index).toBe(0);
    expect(decoded.channel?.role).toBe(1);
    expect(decoded.channel?.settings?.name).toBe('RNDVU');
  });
});

describe('decodeTelemetry', () => {
  test('reads time as fixed32 (not varint) — regression guard', () => {
    // Regression: codec used varintVal on a fixed32 field, returning garbage.
    // Build a Telemetry with time=0x12345678 as fixed32 LE.
    const body = Uint8Array.from([
      tag(1, WIRE_32BIT), 0x78, 0x56, 0x34, 0x12,
    ]);
    const decoded = decodeTelemetry(body);
    expect(decoded.time).toBe(0x12345678);
  });
});

describe('decodePosition', () => {
  test('parses latitudeI/longitudeI as signed fixed32', () => {
    // lat=-33.6803° * 1e7 = -336803000 → two's complement int32
    const latI = -336803000;
    const lngI = -1162378000;
    const toBytes = (v: number) => {
      const n = v >>> 0; // coerce to uint32 for byte extraction
      return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    };
    const body = Uint8Array.from([
      tag(1, WIRE_32BIT), ...toBytes(latI),
      tag(2, WIRE_32BIT), ...toBytes(lngI),
    ]);
    const decoded = decodePosition(body);
    expect(decoded.latitudeI).toBe(latI);
    expect(decoded.longitudeI).toBe(lngI);
  });
});

describe('RNDVU_CHANNEL_PSK', () => {
  test('is exactly 32 bytes', () => {
    expect(RNDVU_CHANNEL_PSK.length).toBe(32);
  });
  test('is not all zeros (regression guard for "forgot to seed")', () => {
    expect(RNDVU_CHANNEL_PSK.every(b => b === 0)).toBe(false);
  });
});

// ── FromRadio encoder → decoder roundtrips ──────────────────────────────────
// These are the tests that prove mock fidelity: anything the mock builds with
// these encoders must round-trip through decodeFromRadio correctly.

describe('FromRadio encoder roundtrips', () => {
  test('encodeFromRadioMyInfo → decodeFromRadio preserves my_node_num + nodedb_count', () => {
    const bytes = encodeFromRadioMyInfo({ myNodeNum: 0x0abbccdd, nodedbCount: 7, rebootCount: 3 });
    const decoded = decodeFromRadio(bytes);
    expect(decoded.myInfo?.myNodeNum).toBe(0x0abbccdd);
    expect(decoded.myInfo?.nodedbCount).toBe(7);
  });

  test('encodeFromRadioNodeInfo roundtrips num + user + position + lastHeard + battery', () => {
    const bytes = encodeFromRadioNodeInfo({
      num: 0xdeadbeef,
      user: { id: '!deadbeef', longName: 'Alex Rivera', shortName: 'Alex' },
      position: { latitudeI: 336803000, longitudeI: -1162378000, time: 1700000000 },
      snr: 8.5,
      lastHeard: 1700000000,
      deviceMetrics: { batteryLevel: 73 },
    });
    const decoded = decodeFromRadio(bytes);
    expect(decoded.nodeInfo?.num).toBe(0xdeadbeef);
    expect(decoded.nodeInfo?.user?.longName).toBe('Alex Rivera');
    expect(decoded.nodeInfo?.user?.shortName).toBe('Alex');
    expect(decoded.nodeInfo?.position?.latitudeI).toBe(336803000);
    expect(decoded.nodeInfo?.position?.longitudeI).toBe(-1162378000);
    expect(decoded.nodeInfo?.snr).toBeCloseTo(8.5, 4);
    expect(decoded.nodeInfo?.lastHeard).toBe(1700000000);
    expect(decoded.nodeInfo?.deviceMetrics?.batteryLevel).toBe(73);
  });

  test('encodeFromRadioChannel roundtrips index + name + role', () => {
    const bytes = encodeFromRadioChannel({ index: 0, name: 'RNDVU', role: 1 });
    const decoded = decodeFromRadio(bytes);
    expect(decoded.channel?.index).toBe(0);
    expect(decoded.channel?.role).toBe(1);
    expect(decoded.channel?.settings?.name).toBe('RNDVU');
  });

  test('encodeFromRadioMetadata roundtrips firmware version + hw model + PKC flag', () => {
    const bytes = encodeFromRadioMetadata({
      firmwareVersion: '2.5.17.abc123',
      hwModel: 7, // T_ECHO
      hasBluetooth: true,
      hasPKC: true,
    });
    const decoded = decodeFromRadio(bytes);
    expect(decoded.metadata?.firmwareVersion).toBe('2.5.17.abc123');
    expect(decoded.metadata?.hwModel).toBe(7);
    expect(decoded.metadata?.hasBluetooth).toBe(true);
    expect(decoded.metadata?.hasPKC).toBe(true);
  });

  test('encodeFromRadioConfigComplete sets field 7 varint', () => {
    const bytes = encodeFromRadioConfigComplete(42);
    const decoded = decodeFromRadio(bytes);
    expect(decoded.configCompleteId).toBe(42);
  });

  test('encodeFromRadioRebooted sets field 8 bool=true', () => {
    const bytes = encodeFromRadioRebooted();
    const decoded = decodeFromRadio(bytes);
    expect(decoded.rebooted).toBe(true);
  });

  test('encodeFromRadioPacket roundtrips text MeshPacket from peer', () => {
    const text = 'hey whats up';
    const payload = new TextEncoder().encode(text);
    const bytes = encodeFromRadioPacket({
      from: 0x1a2b3c,
      to: 0xffffffff,
      channel: 0,
      decoded: { portnum: PortNum.TEXT_MESSAGE_APP, payload },
      id: 0x11223344,
      rxTime: 1700000000,
      rxSnr: 7.25,
    });
    const decoded = decodeFromRadio(bytes);
    expect(decoded.packet?.from).toBe(0x1a2b3c);
    expect(decoded.packet?.to).toBe(0xffffffff);
    expect(decoded.packet?.id).toBe(0x11223344);
    expect(decoded.packet?.rxTime).toBe(1700000000);
    expect(decoded.packet?.rxSnr).toBeCloseTo(7.25, 4);
    expect(decoded.packet?.decoded?.portnum).toBe(PortNum.TEXT_MESSAGE_APP);
    const roundtripText = new TextDecoder().decode(decoded.packet!.decoded!.payload);
    expect(roundtripText).toBe(text);
  });
});
