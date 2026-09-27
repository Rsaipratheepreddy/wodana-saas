import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { appRouteFor } from '../../core/deep-links';

const native = Platform.OS === 'ios' || Platform.OS === 'android';

if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** The link a push notification carries (`deepLink`, as in the inbox). */
const linkOf = (response: Notifications.NotificationResponse | null) => {
  const data = response?.notification.request.content.data as Record<string, unknown> | undefined;
  const link = data?.deepLink ?? data?.url;
  return typeof link === 'string' ? link : null;
};

/**
 * Opening a push notification opens the same record in the app. Registering this phone for pushes
 * (consent, then the Expo token with `crm/device-endpoints`) plugs in here once the project has an EAS id.
 */
export function useNotificationOpens() {
  const router = useRouter();
  useEffect(() => {
    if (!native) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const route = appRouteFor(linkOf(response));
      if (route) router.push(route as Href);
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);
}
