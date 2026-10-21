// When a meetup happens, and when to remind people about it.

export const MEETUP_REMINDER_LEAD_MS = 10 * 60 * 1000;

export function getMeetupDate(hour: number, minute: number, sentAtMs: number): Date {
  // Anchor to the day the meetup was SENT, not the viewer's current day.
  // Anchoring to "now" made a meetup viewed even a minute after its time roll
  // forward a full day ("in 23h" instead of "happening now"). Only roll to the
  // next day if the chosen time is genuinely earlier than when it was sent.
  const target = new Date(sentAtMs);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() < sentAtMs) target.setDate(target.getDate() + 1);
  return target;
}

/**
 * When to fire the "meetup in 10 min" reminder, or null when there's no point:
 * the reminder time has already passed (a meetup set 5 minutes out, or one
 * loaded from history).
 */
export function meetupReminderAt(hour: number, minute: number, sentAtMs: number, nowMs = Date.now()): Date | null {
  const at = getMeetupDate(hour, minute, sentAtMs).getTime() - MEETUP_REMINDER_LEAD_MS;
  return at > nowMs ? new Date(at) : null;
}
