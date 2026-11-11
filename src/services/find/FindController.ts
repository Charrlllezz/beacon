import { bleService } from '../ble/BleManager';
import { buildFindAnswerMessage, buildFindMessage, buildLivePosMessage } from '../mesh/MessageService';
import { useFindStore, type Helping, type Outgoing } from '../../store/useFindStore';
import { useCrewStore } from '../../store/useCrewStore';
import { useDeviceStore } from '../../store/useDeviceStore';

// Find me. The finder's phone:
//   1. sends MF:F (their phone buzzes "Ash is looking for you"),
//   2. asks their radio directly for its position (answered with their phone
//      locked or dead; the firmware answers at most once per 3 minutes),
//   3. reminds them once after 2 minutes if they haven't answered.
// The friend taps the alert and their phone helps for 10 minutes: MF:A says
// so, and MF:P sends phone GPS every 15 s while the app is open. Ultra
// Wideband starts on both sides from the Find screens (#38).
//
// Like the SOS controller, everything is driven by tickFind(): a foreground
// timer plus every packet from the radio, since iOS pauses JS timers while
// the phone is locked.

export const REMIND_AFTER_MS = 2 * 60_000;
// The firmware answers one radio's position requests once per 3 minutes.
export const POSITION_REQUEST_EVERY_MS = 3 * 60_000;
export const SEARCH_MS = 10 * 60_000;
export const HELP_MS = 10 * 60_000;
export const LIVE_EVERY_MS = 15_000;
// An unanswered request stops being offered after this.
export const INCOMING_EXPIRES_MS = 10 * 60_000;

export type FinderStep = 'expire' | 'remind' | 'position';

/** What the finder's side should do now. */
export function finderDue(o: Outgoing | null, now: number): FinderStep[] {
  if (!o) return [];
  if (now - o.askedAt >= SEARCH_MS) return ['expire'];
  const steps: FinderStep[] = [];
  if (o.helping === null && o.remindedAt === null && now - o.askedAt >= REMIND_AFTER_MS) steps.push('remind');
  if (o.positionAskedAt === null || now - o.positionAskedAt >= POSITION_REQUEST_EVERY_MS) steps.push('position');
  return steps;
}

/** What the helping side should do now. */
export function helperDue(h: Helping | null, now: number): 'none' | 'live' | 'expire' {
  if (!h) return 'none';
  if (now - h.startedAt >= HELP_MS) return 'expire';
  if (h.liveSentAt === null || now - h.liveSentAt >= LIVE_EVERY_MS) return 'live';
  return 'none';
}

function connected(): boolean {
  return useDeviceStore.getState().status === 'connected';
}

// Find me traffic is never a chat bubble, so it goes straight to the radio
// rather than through sendCrewMessage.
async function send(text: string): Promise<boolean> {
  if (!connected()) return false;
  try {
    await bleService.sendText(text);
    return true;
  } catch (e) {
    console.warn('find send failed:', e);
    return false;
  }
}

async function askTheirRadio(target: number, now: number): Promise<void> {
  const me = useCrewStore.getState().myLocation;
  // The request carries our position (their radio stores it), so without a
  // fix there's nothing safe to send.
  if (!me || !connected()) return;
  // Marked before sending: the radio can hold the request up to 10 s (see
  // requestPosition), and tickFind runs on every packet meanwhile.
  const o = useFindStore.getState().outgoing;
  if (o?.target === target) useFindStore.getState().setOutgoing({ ...o, positionAskedAt: now });
  try {
    await bleService.requestPosition(target, me);
  } catch (e) {
    console.warn('position request failed:', e);
    const current = useFindStore.getState().outgoing;
    if (current?.target === target) useFindStore.getState().setOutgoing({ ...current, positionAskedAt: null });
  }
}

// ── Finder ──────────────────────────────────────────────────────────────────

/** Start looking for someone. False if the radio isn't connected. */
export async function askToFind(target: number, now = Date.now()): Promise<boolean> {
  if (!(await send(buildFindMessage(target)))) return false;
  useFindStore.getState().setOutgoing({ target, askedAt: now, remindedAt: null, positionAskedAt: null, helping: null });
  // Not awaited: the request may wait up to 10 s behind an earlier one.
  void askTheirRadio(target, now);
  return true;
}

/** Stop looking (found them, or closed Find). Tells them to stop helping. */
export async function cancelFind(): Promise<void> {
  const o = useFindStore.getState().outgoing;
  if (!o) return;
  useFindStore.getState().setOutgoing(null);
  await send(buildFindMessage(o.target, true));
}

// ── Helper ──────────────────────────────────────────────────────────────────

/** The friend tapped "Help them find me". */
export async function startHelping(finder: number, finderName: string, now = Date.now()): Promise<void> {
  useFindStore.getState().setIncoming(null);
  useFindStore.getState().setHelping({ finder, finderName, startedAt: now, liveSentAt: null });
  await send(buildFindAnswerMessage(finder, true));
  await tickFind(now);
}

/** Stop helping. `tell` is false when the finder already called it off. */
export async function stopHelping(tell = true): Promise<void> {
  const h = useFindStore.getState().helping;
  if (!h) return;
  useFindStore.getState().setHelping(null);
  if (tell) await send(buildFindAnswerMessage(h.finder, false));
}

async function sendLive(h: Helping, now: number): Promise<void> {
  const crew = useCrewStore.getState();
  // Only a phone fix: once the phone is locked its GPS stops and the radio
  // already broadcasts its own position.
  if (!crew.myLocation || !crew.myLocationIsPhone) return;
  if (await send(buildLivePosMessage(crew.myLocation.lat, crew.myLocation.lng))) {
    const current = useFindStore.getState().helping;
    if (current?.finder === h.finder) useFindStore.getState().setHelping({ ...current, liveSentAt: now });
  }
}

// Incoming MF:F / MF:A are handled in ./receive (no Bluetooth imports, so
// PacketRouter can use it); re-exported here for one import site.
export { receiveFind, receiveFindAnswer } from './receive';

// ── Tick ────────────────────────────────────────────────────────────────────

let inFlight = false;

export async function tickFind(now = Date.now()): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const store = useFindStore.getState();
    if (store.incoming && now - store.incoming.at >= INCOMING_EXPIRES_MS) store.setIncoming(null);

    const o = store.outgoing;
    for (const step of finderDue(o, now)) {
      if (step === 'expire') { await cancelFind(); break; }
      if (step === 'remind' && o && (await send(buildFindMessage(o.target)))) {
        const current = useFindStore.getState().outgoing;
        if (current?.target === o.target) useFindStore.getState().setOutgoing({ ...current, remindedAt: now });
      }
      if (step === 'position' && o) await askTheirRadio(o.target, now);
    }

    const h = useFindStore.getState().helping;
    const due = helperDue(h, now);
    if (due === 'expire') await stopHelping();
    else if (due === 'live' && h) await sendLive(h, now);
  } finally {
    inFlight = false;
  }
}
