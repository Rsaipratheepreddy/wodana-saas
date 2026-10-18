import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { T } from '../../core/i18n';
import { pushButtons } from './push-button-model';

export { isLater, LATER_ACTION } from './push-button-model';

/** Registers the four button sets the firm's pushes use with the phone (again when the language changes). */
export async function registerPushButtons(t: T) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  for (const [category, buttons] of Object.entries(pushButtons(t))) await Notifications.setNotificationCategoryAsync(category, buttons);
}
