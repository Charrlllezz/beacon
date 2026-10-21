import AsyncStorage from '@react-native-async-storage/async-storage';
import { bleService } from '../ble/BleManager';
import { RNDVU_CHANNEL_NAME } from '../ble/MeshtasticCodec';
import { useCrewKeyStore, makeCrew, newCrewKey, type Crew } from '../../store/useCrewKeyStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { planChannelKey } from './keyPlan';

// Everything that puts a key on the radio goes through here, so pairing,
// Re-provision, joining and leaving all follow the same rules (keyPlan) and
// all use the one-transaction pairing write (one reboot).

const NEEDS_REPROVISION_KEY = 'rndvu_needs_reprovision';

export type ProvisionResult = 'written' | 'choose';

async function owner(): Promise<{ longName: string; shortName: string } | undefined> {
  return (await useCrewStore.getState().loadDisplayName()) ?? undefined;
}

/**
 * Write region, the RNDVU channel with the right key, battery reports and the
 * name. Returns 'choose' (and writes nothing) when Model 2 needs the user to
 * start or join a crew first. Adopting a pre-keyed radio's crew happens here.
 */
export async function provisionRadio(name?: { longName: string; shortName: string }): Promise<ProvisionResult> {
  const { model2, crew } = useCrewKeyStore.getState();
  const plan = planChannelKey({ model2, crew, radio: useDeviceStore.getState().radioChannel });
  if (plan.kind === 'choose') return 'choose';
  if (plan.adopt) useCrewKeyStore.getState().setCrew(plan.adopt);
  await bleService.setChannel(0, RNDVU_CHANNEL_NAME, plan.psk, 1, name ?? await owner());
  return 'written';
}

/**
 * Make this phone's crew `crew` and put its key on the radio. Not connected:
 * the crew is saved and the key goes on at the next connect (the App's
 * re-provision listener). Resolves true when written now.
 */
export async function switchToCrew(crew: Crew): Promise<boolean> {
  useCrewKeyStore.getState().setCrew(crew);
  if (useDeviceStore.getState().status !== 'connected' || !useDeviceStore.getState().myNodeNum) {
    try { await AsyncStorage.setItem(NEEDS_REPROVISION_KEY, '1'); } catch {}
    return false;
  }
  try {
    await bleService.setChannel(0, RNDVU_CHANNEL_NAME, crew.psk, 1, await owner());
    return true;
  } catch (e) {
    console.warn('crew key write failed; will retry on reconnect:', e);
    try { await AsyncStorage.setItem(NEEDS_REPROVISION_KEY, '1'); } catch {}
    return false;
  }
}

export function startCrew(displayName?: string): Promise<boolean> {
  return switchToCrew(makeCrew(newCrewKey(), 'created', displayName));
}

export function joinCrew(psk: Uint8Array, displayName?: string): Promise<boolean> {
  return switchToCrew(makeCrew(psk, 'invite', displayName));
}

/**
 * Leave: the radio goes to a crew of one with a fresh key. It stays on the
 * RNDVU frequency, so it keeps relaying for everyone else.
 */
export function leaveCrew(): Promise<boolean> {
  return switchToCrew(makeCrew(newCrewKey(), 'created', 'Just me'));
}

/**
 * New key for the same crew ("someone left with a radio"). Everyone else has
 * to scan the new invite; the old key keeps working for whoever still has it.
 */
export function rekeyCrew(): Promise<boolean> {
  const current = useCrewKeyStore.getState().crew;
  return switchToCrew(makeCrew(newCrewKey(), 'created', current?.displayName));
}
