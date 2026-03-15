import * as Haptics from 'expo-haptics';

export const hapticLight = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
export const hapticMedium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
export const hapticWarning = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
export const hapticSuccess = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
