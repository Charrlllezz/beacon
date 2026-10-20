import { describe, test, expect } from 'vitest';
import { MockFirmware } from './MockFirmware';
import {
  decodeFromRadio,
  encodeSetChannel,
  RNDVU_CHANNEL_NAME,
  RNDVU_CHANNEL_PSK,
  POSITION_PRECISION_EXACT,
} from './MeshtasticCodec';
import { isSharingLocation, parseFirmwareVersion, compareFirmware } from '../../utils/firmware';
import type { FromRadio } from '../../types/mesh';

const ME = 0x5e6f7a;

function wantConfig(id: number): Uint8Array {
  return new Uint8Array([24, id]); // ToRadio.want_config_id = 3 (varint), id < 128
}

function drain(fw: MockFirmware): FromRadio[] {
  const out: FromRadio[] = [];
  for (let f = fw.getNextFromRadioFrame(); f; f = fw.getNextFromRadioFrame()) out.push(decodeFromRadio(f));
  return out;
}

const primaryChannel = (events: FromRadio[]) => events.find(e => e.channel?.role === 1)?.channel;

describe('channel position precision (firmware ≥2.7.24 fails closed without it)', () => {
  test('setChannel writes module_settings.position_precision = 32', () => {
    const fw = new MockFirmware({ myNodeNum: ME, preProvisioned: false });
    fw.handleToRadio(encodeSetChannel(ME, 0, RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK, 1));
    expect(fw.primaryChannel.positionPrecision).toBe(POSITION_PRECISION_EXACT);
  });

  test('the config drain reports it back, decoded into channel settings', () => {
    const fw = new MockFirmware({ myNodeNum: ME });
    fw.handleToRadio(wantConfig(42));
    expect(primaryChannel(drain(fw))?.settings?.positionPrecision).toBe(32);
  });

  test('a channel from an older RNDVU build decodes as "no module_settings"', () => {
    const fw = new MockFirmware({ myNodeNum: ME, positionPrecision: null });
    fw.handleToRadio(wantConfig(42));
    const ch = primaryChannel(drain(fw));
    expect(ch?.settings?.name).toBe(RNDVU_CHANNEL_NAME);
    expect(ch?.settings?.positionPrecision).toBeUndefined();
  });

  test('present-but-empty module_settings decodes as 0 (sharing off)', () => {
    const fw = new MockFirmware({ myNodeNum: ME, positionPrecision: 0 });
    fw.handleToRadio(wantConfig(42));
    expect(primaryChannel(drain(fw))?.settings?.positionPrecision).toBe(0);
  });
});

describe('isSharingLocation', () => {
  test('explicit precision decides', () => {
    expect(isSharingLocation(32, '2.7.26.54e0d8d')).toBe(true);
    expect(isSharingLocation(13, '2.7.26.54e0d8d')).toBe(true);
    expect(isSharingLocation(0, '2.5.17')).toBe(false);
  });

  test('no module_settings: on before 2.7.24, off from 2.7.24', () => {
    expect(isSharingLocation(null, '2.7.23.b246bcd')).toBe(true);
    expect(isSharingLocation(null, '2.7.24.472b14c')).toBe(false);
    expect(isSharingLocation(null, '2.8.1.8e6a88d')).toBe(false);
  });

  test('unknown until the drain reports it or firmware is known', () => {
    expect(isSharingLocation(undefined, '2.7.26')).toBeNull();
    expect(isSharingLocation(null, null)).toBeNull();
  });

  test('version parsing and ordering', () => {
    expect(parseFirmwareVersion('2.7.26.54e0d8d')).toEqual([2, 7, 26]);
    expect(parseFirmwareVersion('v2.8.1')).toEqual([2, 8, 1]);
    expect(parseFirmwareVersion('garbage')).toBeNull();
    expect(compareFirmware([2, 7, 9], [2, 7, 24])).toBeLessThan(0);
    expect(compareFirmware([2, 8, 0], [2, 7, 26])).toBeGreaterThan(0);
  });
});
