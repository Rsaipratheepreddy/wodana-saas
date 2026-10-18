import * as Haptics from 'expo-haptics';
import { AccessibilityInfo, Platform } from 'react-native';

const quiet = () => undefined;
const device = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * The person's "Sound & haptics" choice (Me, saved on their profile and on by default) and the phone's reduce-motion
 * setting. The phone itself decides the rest: iOS follows its System Haptics switch and Android its touch-feedback
 * setting, so silent or vibrate-off phones stay still.
 */
const settings = { chosen: true, reduceMotion: false };
if (device) {
  void AccessibilityInfo.isReduceMotionEnabled().then((value) => { settings.reduceMotion = value; }).catch(quiet);
  AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => { settings.reduceMotion = value; });
}

/** Set from the signed-in profile and from Me → Sound & haptics. */
export function setHapticsEnabled(enabled: boolean) {
  settings.chosen = enabled;
}

export function hapticsEnabled() {
  return device && settings.chosen && !settings.reduceMotion;
}

const run = (touch: () => Promise<void>) => { if (hapticsEnabled()) void touch().catch(quiet); };

/** Light touches for key moments: a tap, a saved record, a refusal, an approval, a message sent, a refresh. */
export const haptic = {
  tap: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  impact: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Something approved: the same as a success, so approving feels like finishing. */
  approve: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** A message or report sent: one light, quick touch. */
  send: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Pull to refresh caught: a soft tick. */
  refresh: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
};
