import { describe, test, expect } from 'vitest';
import { reminderActions } from './meetupReminderSync';
import type { Message, MeetupMessage, ReplyKind } from '../../types/messages';

const ME = 7;
const meetup: MeetupMessage = {
  id: 'meet', fromNodeId: 2, fromName: 'Bo', timestamp: 1000, channelIndex: 0,
  type: 'meetup', hour: 23, minute: 30, location: 'Main gate', packetId: 0xabc,
};
const myReply = (kind: ReplyKind, id: string, at = 2000): Message => ({
  id, fromNodeId: ME, fromName: 'Me', timestamp: at, channelIndex: 0, type: 'reply', kind, replyTo: 0xabc,
});

describe('reminderActions', () => {
  test('a new meetup gets a reminder', () => {
    expect(reminderActions([], [meetup], ME)).toEqual({ schedule: [meetup], cancel: [] });
  });

  test('nothing new, nothing to do', () => {
    expect(reminderActions([meetup], [meetup], ME)).toEqual({ schedule: [], cancel: [] });
  });

  test("my Can't make it drops the reminder; On my way sets it again", () => {
    const cant = myReply('cant', 'r1');
    expect(reminderActions([meetup], [meetup, cant], ME)).toEqual({ schedule: [], cancel: ['meet'] });
    const omw = myReply('omw', 'r2', 3000);
    expect(reminderActions([meetup, cant], [meetup, cant, omw], ME)).toEqual({ schedule: [meetup], cancel: [] });
  });

  test("at launch, a meetup I said I can't make stays without a reminder", () => {
    expect(reminderActions([], [meetup, myReply('cant', 'r1')], ME).schedule).toEqual([]);
  });

  test("someone else's answer changes nothing for me", () => {
    const theirs: Message = { ...myReply('cant', 'r9'), fromNodeId: 3 };
    expect(reminderActions([meetup], [meetup, theirs], ME)).toEqual({ schedule: [], cancel: [] });
  });
});
