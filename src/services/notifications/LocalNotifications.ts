import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Message } from '../../types/messages';
import { noticeForMessage } from './NotificationPolicy';

// Local notifications only: no push server, no token. Every notification is
// raised on-device when a mesh packet arrives while RNDVU is backgrounded
// (iOS keeps the BLE link up via bluetooth-central and wakes us per packet).

let handlerSet = false;

/** Call once at startup. Foreground arrivals stay silent; the chat shows them. */
export function configureNotifications(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
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

export function notifyForMessage(message: Message, myNodeNum: number | null): void {
  const notice = noticeForMessage(message, {
    // 'inactive' (app switcher, Control Center) counts as away: the user
    // isn't looking at the chat.
    appActive: AppState.currentState === 'active',
    myNodeNum,
  });
  if (!notice) return;
  Notifications.scheduleNotificationAsync({
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
