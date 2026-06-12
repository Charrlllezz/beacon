import { describe, test, expect } from 'vitest';
import { decodeFromRadio, regionName } from './MeshtasticCodec';

describe('regionName', () => {
  test('maps known and unknown region codes', () => {
    expect(regionName(1)).toBe('US');
    expect(regionName(0)).toBe('UNSET');
    expect(regionName(null)).toBe('—');
    expect(regionName(undefined)).toBe('—');
    expect(regionName(99)).toBe('#99');
  });
});

describe('FromRadio config → LoRa region decode', () => {
  test('decodes Config.lora.region through the field chain (5 → 6 → 7)', () => {
    // Hand-built protobuf: FromRadio{ config(5) = Config{ lora(6) = LoRaConfig{ region(7) = US(1) } } }
    //  0x2a = field 5, len-delim | 0x04 len
    //    0x32 = field 6, len-delim | 0x02 len
    //      0x38 = field 7, varint | 0x01 value (US)
    const frame = new Uint8Array([0x2a, 0x04, 0x32, 0x02, 0x38, 0x01]);
    const fr = decodeFromRadio(frame);
    expect(fr.config?.lora?.region).toBe(1);
    expect(regionName(fr.config?.lora?.region)).toBe('US');
  });

  test('region absent when no config frame present', () => {
    const fr = decodeFromRadio(new Uint8Array([0x38, 0x2a])); // configCompleteId(7)=42, unrelated
    expect(fr.config).toBeUndefined();
  });
});
