import { describe, test, expect, vi, beforeEach } from 'vitest';

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { storage.set(k, v); },
    removeItem: async (k: string) => { storage.delete(k); },
  },
}));
let seed = 1;
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, () => (seed++ * 31) & 0xff || 1),
}));
const setChannel = vi.fn(async () => {});
vi.mock('../ble/BleManager', () => ({ bleService: { setChannel: (...a: unknown[]) => setChannel(...(a as [])) } }));

// Alert: press the button whose text matches `alertChoice` (or the last one).
let alertChoice: string | null = null;
const alerts: string[] = [];
vi.mock('react-native', () => ({
  Alert: {
    alert: (title: string, _body?: string, buttons?: { text: string; onPress?: () => void }[]) => {
      alerts.push(title);
      const b = buttons?.find(x => x.text === alertChoice) ?? buttons?.[buttons.length - 1];
      b?.onPress?.();
    },
  },
}));

import { provisionRadio, joinCrew, leaveCrew, rekeyCrew, startCrew } from './crewActions';
import { confirmJoin } from './confirmJoin';
import { buildInviteUrl, crewIdFor } from './invite';
import { useCrewKeyStore, makeCrew } from '../../store/useCrewKeyStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { CREW_CHANNEL_PSK } from '../../config/channelKey';
import { RNDVU_CHANNEL_NAME } from '../ble/MeshtasticCodec';

const PREKEYED = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
const OWNER = { longName: 'Ash', shortName: 'ASH' };
const writtenKey = () => (setChannel.mock.calls.at(-1) as unknown as [number, string, Uint8Array])[2];

beforeEach(() => {
  storage.clear();
  alerts.length = 0;
  alertChoice = null;
  setChannel.mockClear();
  useCrewKeyStore.setState({ crew: null, model2: true, loaded: true });
  useDeviceStore.setState({ status: 'connected', myNodeNum: 0x1234, radioChannel: null });
  useCrewStore.setState({ crewMembers: {} });
  storage.set('rndvu_display_name', JSON.stringify(OWNER));
});

describe('provisionRadio', () => {
  test('Model 2 off: the build key, as before', async () => {
    useCrewKeyStore.setState({ model2: false });
    expect(await provisionRadio(OWNER)).toBe('written');
    expect(setChannel).toHaveBeenCalledWith(0, RNDVU_CHANNEL_NAME, CREW_CHANNEL_PSK, 1, OWNER);
  });

  test('a shipped, pre-keyed radio: adopt its crew and keep its key', async () => {
    useDeviceStore.setState({ radioChannel: { name: 'RNDVU', psk: PREKEYED } });
    expect(await provisionRadio(OWNER)).toBe('written');
    expect(writtenKey()).toEqual(PREKEYED);
    expect(useCrewKeyStore.getState().crew).toMatchObject({ id: crewIdFor(PREKEYED), source: 'radio' });
  });

  test('blank radio, no crew: nothing written, ask the user', async () => {
    useDeviceStore.setState({ radioChannel: { name: undefined, psk: Uint8Array.of(1) } });
    expect(await provisionRadio(OWNER)).toBe('choose');
    expect(setChannel).not.toHaveBeenCalled();
  });
});

describe('start, join, leave, rekey', () => {
  test('start writes a fresh crew key with the saved name', async () => {
    expect(await startCrew('Ash crew')).toBe(true);
    const crew = useCrewKeyStore.getState().crew!;
    expect(crew).toMatchObject({ displayName: 'Ash crew', source: 'created' });
    expect(setChannel).toHaveBeenCalledWith(0, RNDVU_CHANNEL_NAME, crew.psk, 1, OWNER);
  });

  test('rekey keeps the name, changes the key; leave goes to a crew of one', async () => {
    await startCrew('Ash crew');
    const first = useCrewKeyStore.getState().crew!;
    await rekeyCrew();
    const rekeyed = useCrewKeyStore.getState().crew!;
    expect(rekeyed.displayName).toBe('Ash crew');
    expect(rekeyed.psk).not.toEqual(first.psk);
    await leaveCrew();
    expect(useCrewKeyStore.getState().crew!.displayName).toBe('Just me');
    expect(writtenKey()).toEqual(useCrewKeyStore.getState().crew!.psk);
  });

  test('not connected: the crew is saved and the radio is updated on reconnect', async () => {
    useDeviceStore.setState({ status: 'reconnecting' });
    expect(await joinCrew(PREKEYED, 'Bo crew')).toBe(false);
    expect(setChannel).not.toHaveBeenCalled();
    expect(useCrewKeyStore.getState().crew?.displayName).toBe('Bo crew');
    expect(storage.get('rndvu_needs_reprovision')).toBe('1');
    // ...which provisionRadio then writes.
    useDeviceStore.setState({ status: 'connected' });
    expect(await provisionRadio(OWNER)).toBe('written');
    expect(writtenKey()).toEqual(PREKEYED);
  });
});

describe('confirmJoin', () => {
  test('scanning an invite joins that crew after confirming', async () => {
    alertChoice = 'Join';
    expect(await confirmJoin(buildInviteUrl(PREKEYED, 'Bo crew'))).toBe(true);
    expect(useCrewKeyStore.getState().crew).toMatchObject({ id: crewIdFor(PREKEYED), displayName: 'Bo crew', source: 'invite' });
    expect(writtenKey()).toEqual(PREKEYED);
  });

  test('cancel changes nothing; the same crew again is a no-op', async () => {
    alertChoice = 'Cancel';
    expect(await confirmJoin(buildInviteUrl(PREKEYED))).toBe(false);
    expect(useCrewKeyStore.getState().crew).toBeNull();
    useCrewKeyStore.setState({ crew: makeCrew(PREKEYED, 'invite') });
    expect(await confirmJoin(buildInviteUrl(PREKEYED))).toBe(false);
    expect(alerts.at(-1)).toBe("You're already in this crew");
    expect(setChannel).not.toHaveBeenCalled();
  });

  test('a non-RNDVU QR is refused with a reason', async () => {
    expect(await confirmJoin('https://example.com')).toBe(false);
    expect(alerts.at(-1)).toBe("That's not a crew invite");
  });

  test('joining from an invite turns per-crew keys on', async () => {
    useCrewKeyStore.setState({ model2: false });
    alertChoice = 'Join';
    await confirmJoin(buildInviteUrl(PREKEYED));
    expect(useCrewKeyStore.getState().model2).toBe(true);
  });
});
