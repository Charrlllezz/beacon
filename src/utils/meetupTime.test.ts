import { describe, test, expect } from 'vitest';
import { getMeetupDate, meetupReminderAt, MEETUP_REMINDER_LEAD_MS } from './meetupTime';

// 2026-12-31 21:00 local
const SENT = new Date(2026, 11, 31, 21, 0, 0).getTime();

describe('meetup time', () => {
  test('later the same evening', () => {
    expect(getMeetupDate(23, 30, SENT)).toEqual(new Date(2026, 11, 31, 23, 30));
  });

  test('a time earlier than when it was sent means tomorrow (after midnight)', () => {
    expect(getMeetupDate(0, 30, SENT)).toEqual(new Date(2027, 0, 1, 0, 30));
  });

  test('reminder 10 minutes before', () => {
    expect(meetupReminderAt(23, 30, SENT, SENT)).toEqual(new Date(new Date(2026, 11, 31, 23, 30).getTime() - MEETUP_REMINDER_LEAD_MS));
  });

  test('no reminder once its time has passed', () => {
    // Meetup at 21:05, sent at 21:00: the reminder would be at 20:55.
    expect(meetupReminderAt(21, 5, SENT, SENT)).toBeNull();
    // Loaded from history after the meetup.
    expect(meetupReminderAt(23, 30, SENT, new Date(2027, 0, 1, 2, 0).getTime())).toBeNull();
  });
});
