import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const quiet = () => undefined;
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

/** Light touches for key moments: a tap, a saved record, a refusal. Silent on the web. */
export const haptic = {
  tap: () => { if (enabled) void Haptics.selectionAsync().catch(quiet); },
  success: () => { if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(quiet); },
  warning: () => { if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(quiet); },
  error: () => { if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(quiet); },
  impact: () => { if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(quiet); },
};
