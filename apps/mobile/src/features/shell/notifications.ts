import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../core/api';
import { routeForDestination, type NoticeDestination } from '../../core/deep-links';
import { useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { useToast } from '../../ui/toast';
import { inboxKey, useInbox } from '../inbox/api';
import { pushOpening } from './push-open';
import { notificationSettingsKey } from './push-registration';

const native = Platform.OS === 'ios' || Platform.OS === 'android';

if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

const opened = new Set<string>();
const within = <T,>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * Opening a push notification opens the same record in the app (registration: `push-registration.ts`).
 * The server marks it read; a link the app can't read itself (a job) is resolved by the server; a push for
 * another workspace opens nothing here. A push that arrives while the app is open refreshes the inbox, and
 * the app badge counts what is unread.
 */
export function useNotificationOpens() {
  const router = useRouter();
  const api = useApi();
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { workspaceId } = useSession();
  const { unread, enabled } = useInbox();

  useEffect(() => {
    if (!native) return;
    const open = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      // The last response survives a sign-in (the layout mounts again): each push opens once.
      const identifier = response.notification.request.identifier;
      if (opened.has(identifier)) return;
      opened.add(identifier);
      const target = pushOpening(response.notification.request.content.data, workspaceId);
      if (target.otherWorkspace) { toast.show(t('This notification is for another workspace.')); return; }
      let route = target.route;
      if (target.notificationId) {
        const marked = api.send<{ destination?: NoticeDestination; fallback?: boolean }>(`crm/notifications/${target.notificationId}/open`, 'POST').catch(() => null);
        if (!route) route = routeForDestination((await within(marked, 4000))?.destination);
        void marked.then(() => queryClient.invalidateQueries({ queryKey: inboxKey(workspaceId) }));
      }
      // A push the app has no screen for opens the inbox, where the notice opens on the web.
      router.push((route ?? '/inbox') as Href);
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => { void open(response); });
    const arrived = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: inboxKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: notificationSettingsKey(workspaceId) });
    });
    return () => { tapped.remove(); arrived.remove(); };
  }, [router, api, t, toast, queryClient, workspaceId]);

  useEffect(() => {
    if (!native || !enabled) return;
    void Notifications.setBadgeCountAsync(unread).catch(() => undefined);
  }, [unread, enabled]);
  // Signed out or another workspace: the badge no longer counts anything.
  useEffect(() => () => { if (native) void Notifications.setBadgeCountAsync(0).catch(() => undefined); }, [workspaceId]);
}
