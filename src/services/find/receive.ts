import { useFindStore } from '../../store/useFindStore';
import type { FindAnswerMessage, FindMessage } from '../../types/messages';

// Incoming Find me packets. Store updates only, no radio writes, so
// PacketRouter can import this without pulling in Bluetooth.

export function receiveFind(from: number, fromName: string, msg: FindMessage, myNodeNum: number | null, now = Date.now()): void {
  if (myNodeNum === null || msg.target !== myNodeNum) return;
  const store = useFindStore.getState();
  if (msg.cancel) {
    // The finder found us or gave up. No answer needed.
    if (store.incoming?.finder === from) store.setIncoming(null);
    if (store.helping?.finder === from) store.setHelping(null);
    return;
  }
  if (store.helping?.finder === from) return; // already helping them
  store.setIncoming({ finder: from, finderName: fromName, at: now });
}

export function receiveFindAnswer(from: number, msg: FindAnswerMessage, myNodeNum: number | null): void {
  if (myNodeNum === null || msg.finder !== myNodeNum) return;
  const o = useFindStore.getState().outgoing;
  if (o?.target === from) useFindStore.getState().setOutgoing({ ...o, helping: msg.helping });
}
