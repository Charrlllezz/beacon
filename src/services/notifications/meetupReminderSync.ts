import type { Message, MeetupMessage } from '../../types/messages';
import { respondersTo, myAnswer } from '../../utils/replies';

export interface ReminderActions {
  schedule: MeetupMessage[];
  cancel: string[]; // meetup message ids
}

/**
 * Which meetup reminders to set or drop after the message list changed.
 * - A new meetup (sent, received, or loaded at launch) gets a reminder,
 *   unless I've said I can't make it.
 * - My own "Can't make it" drops it; changing my mind to "On my way" sets it
 *   again.
 * Scheduling is idempotent and skips past times, so re-running is harmless.
 */
export function reminderActions(prev: Message[], next: Message[], myNodeNum: number | null): ReminderActions {
  const seen = new Set(prev.map(m => m.id));
  const added = next.filter(m => !seen.has(m.id));
  const schedule: MeetupMessage[] = [];
  const cancel: string[] = [];

  const meetupByPacket = new Map<number, MeetupMessage>();
  for (const m of next) if (m.type === 'meetup' && m.packetId) meetupByPacket.set(m.packetId, m);
  const iCantMake = (meetup: MeetupMessage) => myAnswer(respondersTo(next, meetup.packetId), myNodeNum) === 'cant';

  for (const m of added) {
    if (m.type === 'meetup') {
      if (!iCantMake(m)) schedule.push(m);
    } else if (m.type === 'reply' && myNodeNum !== null && m.fromNodeId === myNodeNum && m.replyTo) {
      const meetup = meetupByPacket.get(m.replyTo);
      if (!meetup) continue;
      if (m.kind === 'cant') cancel.push(meetup.id);
      else if (m.kind === 'omw') schedule.push(meetup);
    }
  }
  return { schedule, cancel };
}
