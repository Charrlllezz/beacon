import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Message, MeetupMessage } from '../../types/messages';
import { noticeForMessage, type SosContext } from './NotificationPolicy';
import { meetupReminderAt } from '../../utils/meetupTime';
import { formatClock } from '../../utils/time';

// Local notifications only: no push server, no token. Every notification is
// raised on-device when a mesh packet arrives while RNDVU is backgrounded
// (iOS keeps the BLE link up via bluetooth-central and wakes us per packet).

let handlerSet = false;

/** Call once at startup. Foreground arrivals stay silent; the chat shows them. */
export function configureNotifications(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // A meetup reminder is the one thing worth a banner while the app is
      // open: nothing in the chat says "10 minutes to go".
      const reminder = n.request.content.data?.type === MEETUP_REMINDER;
      return {
        shouldShowBanner: reminder,
        shouldShowList: true,
        shouldPlaySound: reminder,
        shouldSetBadge: false,
      };
    },
  });
}

const MEETUP_REMINDER = 'meetup-reminder';
const reminderId = (meetupId: string) => `meetup-${meetupId}`;

/**
 * Remind this phone 10 minutes before a meetup. Local only, no airtime. Safe
 * to call repeatedly: the same meetup keeps one reminder, and one whose time
 * has passed is skipped.
 */
export function scheduleMeetupReminder(meetup: MeetupMessage, locationLabel: string): void {
  const at = meetupReminderAt(meetup.hour, meetup.minute, meetup.timestamp);
  if (!at) return;
  Notifications.scheduleNotificationAsync({
    identifier: reminderId(meetup.id),
    content: {
      title: `Meetup in 10 min: ${locationLabel}`,
      body: `${formatClock(meetup.hour, meetup.minute)}${meetup.note ? `. ${meetup.note}` : ''}`,
      sound: 'default',
      interruptionLevel: 'timeSensitive',
      data: { type: MEETUP_REMINDER, messageId: meetup.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  }).catch((e) => console.warn('meetup reminder failed:', e));
}

export function cancelMeetupReminder(meetupId: string): void {
  Notifications.cancelScheduledNotificationAsync(reminderId(meetupId)).catch(() => {});
}

/**
 * Ask once. Onboarding calls this right after the radio connects (Bluetooth
 * first, then notifications); App.tsx also calls it for users who onboarded
 * before notifications existed. No-op once the user has answered either way.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const next = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return next.granted;
  } catch (e) {
    console.warn('notification permission request failed:', e);
    return false;
  }
}

export function notifyForMessage(
  message: Message,
  myNodeNum: number | null,
  replyTarget?: Message,
  sos?: SosContext,
): void {
  const notice = noticeForMessage(message, {
    // 'inactive' (app switcher, Control Center) counts as away: the user
    // isn't looking at the chat.
    appActive: AppState.currentState === 'active',
    myNodeNum,
    replyTarget,
    sos,
  });
  if (!notice) return;
  Notifications.scheduleNotificationAsync({
    ...(notice.replaceKey ? { identifier: notice.replaceKey } : {}),
    content: {
      title: notice.title,
      body: notice.body,
      sound: 'default',
      interruptionLevel: notice.timeSensitive ? 'timeSensitive' : 'active',
      data: { messageId: message.id, type: message.type },
    },
    trigger: null, // now
  }).catch((e) => console.warn('scheduleNotificationAsync failed:', e));
}
