import { describe, test, expect, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const mem = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => mem.get(k) ?? null,
      setItem: async (k: string, v: string) => { mem.set(k, v); },
      removeItem: async (k: string) => { mem.delete(k); },
    },
  };
});
let nextByte = 1;
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, () => (nextByte++ % 255) + 1),
}));

import { buildInviteUrl, buildMeshtasticUrl, parseInvite, toBase64Url, fromBase64Url, crewIdFor } from './invite';
import { planChannelKey } from './keyPlan';
import { useCrewKeyStore, makeCrew, newCrewKey } from '../../store/useCrewKeyStore';
import {
  encodeChannelSet, decodeChannelSet, decodeFromRadio, encodeFromRadioChannel,
  RNDVU_CHANNEL_PSK, POSITION_PRECISION_EXACT,
} from '../ble/MeshtasticCodec';
import { CREW_CHANNEL_PSK } from '../../config/channelKey';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);

describe('ChannelSet', () => {
  test('the radio key survives the config drain decode (for adopting a shipped radio)', () => {
    const frame = encodeFromRadioChannel({ index: 0, name: 'RNDVU', role: 1, positionPrecision: 32, psk: KEY });
    const ch = decodeFromRadio(frame).channel!;
    expect(ch.psk).toEqual(KEY);
    expect(ch.keyFingerprint).toBe(crewIdFor(KEY));
  });

  test('round trips channels and LoRa settings', () => {
    const bytes = encodeChannelSet(
      [{ name: 'RNDVU', psk: KEY, positionPrecision: 32 }],
      { usePreset: true, modemPreset: 0, region: 1, hopLimit: 3, txEnabled: true },
    );
    expect(decodeChannelSet(bytes)).toEqual({
      channels: [{ name: 'RNDVU', psk: KEY, positionPrecision: 32 }],
      lora: { usePreset: true, modemPreset: 0, region: 1, hopLimit: 3, txEnabled: true },
    });
  });

  test('reads a default-channel link in the shape the Meshtastic app shares', () => {
    // Hand-built from the protobufs (not captured from the official app):
    // default channel (name empty, psk = the 1-byte default-key marker),
    // preset on, hop limit 3. A real-app fixture is on the hardware checklist.
    const { channels, lora } = decodeChannelSet(fromBase64Url('CgMSAQESBggBQANIAQ')!);
    expect(channels).toEqual([{ name: '', psk: Uint8Array.of(1) }]);
    expect(lora).toMatchObject({ usePreset: true, hopLimit: 3, txEnabled: true });
  });
});

describe('invites', () => {
  test('RNDVU invite round trip, with the crew name', () => {
    const url = buildInviteUrl(KEY, "Ash's crew");
    expect(url.startsWith('rndvu://join#v=1&cs=')).toBe(true);
    expect(parseInvite(url)).toEqual({ ok: true, invite: { psk: KEY, crewName: "Ash's crew" } });
  });

  test('the invite carries channel RNDVU at exact precision and US LONG_FAST', () => {
    const cs = new URLSearchParams(buildInviteUrl(KEY).split('#')[1]).get('cs')!;
    expect(decodeChannelSet(fromBase64Url(cs)!)).toEqual({
      channels: [{ name: 'RNDVU', psk: KEY, positionPrecision: POSITION_PRECISION_EXACT }],
      lora: { usePreset: true, modemPreset: 0, region: 1, hopLimit: 3, txEnabled: true },
    });
  });

  test('a Meshtastic QR of an RNDVU crew joins too; the future https form is accepted', () => {
    expect(parseInvite(buildMeshtasticUrl(KEY))).toEqual({ ok: true, invite: { psk: KEY, crewName: undefined } });
    const https = buildInviteUrl(KEY, 'Bo').replace('rndvu://join', 'https://rndvu.example/join');
    expect(parseInvite(https)).toMatchObject({ ok: true, invite: { crewName: 'Bo' } });
  });

  test('refuses other channels, bad keys and junk', () => {
    const other = `https://meshtastic.org/e/#${toBase64Url(encodeChannelSet([{ name: 'LongFast', psk: KEY }], {}))}`;
    expect(parseInvite(other)).toEqual({ ok: false, error: 'not-rndvu' });
    const shortKey = `https://meshtastic.org/e/#${toBase64Url(encodeChannelSet([{ name: 'RNDVU', psk: KEY.slice(0, 16) }], {}))}`;
    expect(parseInvite(shortKey)).toEqual({ ok: false, error: 'bad-key' });
    expect(parseInvite('https://example.com/hello')).toEqual({ ok: false, error: 'not-an-invite' });
    expect(parseInvite('rndvu://join#v=1')).toEqual({ ok: false, error: 'not-an-invite' });
    expect(parseInvite('rndvu://join#cs=%%%')).toEqual({ ok: false, error: 'not-an-invite' });
  });
});

describe('planChannelKey', () => {
  const crew = makeCrew(KEY, 'created', 'Ash');
  const PREKEYED = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);

  test('Model 2 off: the build key, whatever the radio has', () => {
    expect(planChannelKey({ model2: false, crew, radio: { name: 'RNDVU', psk: PREKEYED } }))
      .toEqual({ kind: 'write', psk: CREW_CHANNEL_PSK });
  });

  test("in a crew: the crew's key", () => {
    expect(planChannelKey({ model2: true, crew, radio: { name: 'RNDVU', psk: PREKEYED } }))
      .toEqual({ kind: 'write', psk: KEY });
  });

  test('no crew, shipped radio pre-keyed: adopt its crew', () => {
    const plan = planChannelKey({ model2: true, crew: null, radio: { name: 'RNDVU', psk: PREKEYED } });
    expect(plan.kind).toBe('write');
    if (plan.kind !== 'write') return;
    expect(plan.psk).toEqual(PREKEYED);
    expect(plan.adopt).toMatchObject({ id: crewIdFor(PREKEYED), source: 'radio' });
  });

  test('no crew, radio blank or on a shared key: ask', () => {
    for (const radio of [
      null,
      { name: undefined, psk: Uint8Array.of(1) },              // factory default
      { name: 'RNDVU', psk: RNDVU_CHANNEL_PSK },               // Model 1
      { name: 'RNDVU', psk: CREW_CHANNEL_PSK },                // this build's key
      { name: 'LongFast', psk: PREKEYED },                     // someone else's channel
    ]) {
      expect(planChannelKey({ model2: true, crew: null, radio })).toEqual({ kind: 'choose' });
    }
  });
});

describe('crew store', () => {
  test('new keys are 32 bytes from the secure source and differ', () => {
    const a = newCrewKey();
    const b = newCrewKey();
    expect(a.length).toBe(32);
    expect(a).not.toEqual(b);
  });

  test('persists and reloads the crew and the Model 2 switch', async () => {
    const crew = makeCrew(KEY, 'invite', "Ash's crew");
    useCrewKeyStore.getState().setCrew(crew);
    useCrewKeyStore.getState().setModel2(true);
    useCrewKeyStore.setState({ crew: null, model2: false, loaded: false });
    await new Promise(r => setTimeout(r, 0));
    await useCrewKeyStore.getState().load();
    const s = useCrewKeyStore.getState();
    expect(s.model2).toBe(true);
    expect(s.crew).toMatchObject({ id: crew.id, psk: KEY, displayName: "Ash's crew", source: 'invite' });
  });

  test('a crew name defaults to its id', () => {
    expect(makeCrew(KEY, 'created').displayName).toBe(`Crew ${crewIdFor(KEY)}`);
  });
});
