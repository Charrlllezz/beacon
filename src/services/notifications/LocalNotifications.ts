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
  // "Ash is looking for you": one tap opens RNDVU and starts helping.
  Notifications.setNotificationCategoryAsync(FIND_REQUEST, [
    { identifier: FIND_HELP_ACTION, buttonTitle: 'Help them find me', options: { opensAppToForeground: true } },
    { identifier: FIND_NOT_NOW_ACTION, buttonTitle: 'Not now', options: { opensAppToForeground: false } },
  ]).catch((e) => console.warn('find category failed:', e));
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

export const FIND_REQUEST = 'find-request';
export const FIND_HELP_ACTION = 'find-help';
export const FIND_NOT_NOW_ACTION = 'find-not-now';
const findRequestId = (finder: number) => `find-${finder}`;

/**
 * "Ash is looking for you", time-sensitive so it gets through Focus. A
 * reminder replaces the first one rather than stacking.
 */
export function notifyFindRequest(finder: number, finderName: string): void {
  Notifications.scheduleNotificationAsync({
    identifier: findRequestId(finder),
    content: {
      title: `${finderName} is looking for you`,
      body: 'Tap to help them find you. Your phone shares your exact spot for 10 minutes.',
      sound: 'default',
      interruptionLevel: 'timeSensitive',
      categoryIdentifier: FIND_REQUEST,
      data: { type: FIND_REQUEST, finder, finderName },
    },
    trigger: null,
  }).catch((e) => console.warn('find notification failed:', e));
}

export function clearFindRequest(finder: number): void {
  Notifications.dismissNotificationAsync(findRequestId(finder)).catch(() => {});
}

/** What a tap on a notification asks for, if it's a find request. */
export function findRequestFromResponse(r: Notifications.NotificationResponse | null): { finder: number; finderName: string; help: boolean } | null {
  const data = r?.notification.request.content.data as { type?: string; finder?: number; finderName?: string } | undefined;
  if (!r || data?.type !== FIND_REQUEST || typeof data.finder !== 'number') return null;
  return { finder: data.finder, finderName: data.finderName ?? 'Your crew', help: r.actionIdentifier !== FIND_NOT_NOW_ACTION };
}
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
