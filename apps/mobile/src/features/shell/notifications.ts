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

const opened = new Set<string>();

/** The link a push notification carries (`deepLink`, as in the inbox). */
const linkOf = (response: Notifications.NotificationResponse | null) => {
  const data = response?.notification.request.content.data as Record<string, unknown> | undefined;
  const link = data?.deepLink ?? data?.url;
  return typeof link === 'string' ? link : null;
};

/** Opening a push notification opens the same record in the app (registration: `push-registration.ts`). */
export function useNotificationOpens() {
  const router = useRouter();
  useEffect(() => {
    if (!native) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      // The last response survives a sign-in (the layout mounts again): each push opens once.
      const identifier = response.notification.request.identifier;
      if (opened.has(identifier)) return;
      opened.add(identifier);
      // A push the app has no screen for opens the inbox, where the notice opens on the web.
      router.push((appRouteFor(linkOf(response)) ?? '/inbox') as Href);
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);
}
