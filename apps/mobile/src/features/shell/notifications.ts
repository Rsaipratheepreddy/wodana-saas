import { useCallback, useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../core/api';
import { appRouteFor, routeForDestination, type NoticeDestination } from '../../core/deep-links';
import { useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { useToast } from '../../ui/toast';
import { approvalsKey } from '../approvals/api';
import { inboxKey, useInbox } from '../inbox/api';
import { APPROVE_ACTION, type ApprovalOutcome, type PushApproval } from './approval-action-model';
import { approveFromNotice, noticeFor, postNotice, registerApprovalCategories, sendPendingApprovals } from './approval-actions';
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
 * the app badge counts what is unread. An approval's Approve button decides it without opening anything
 * (`approval-actions.ts`); a decision the phone couldn't send yet goes out when the app next comes back.
 */
export function useNotificationOpens() {
  const router = useRouter();
  const api = useApi();
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { workspaceId } = useSession();
  const { unread, enabled } = useInbox();

  // How a decision went: a toast while the app is in front, a quiet notice when it isn't.
  const report = useCallback((outcome: ApprovalOutcome, item: PushApproval) => {
    void queryClient.invalidateQueries({ queryKey: approvalsKey(workspaceId) });
    if (AppState.currentState !== 'active') { postNotice(noticeFor(t, outcome, item)); return; }
    const route = appRouteFor(item.deepLink) ?? '/approvals';
    if (outcome === 'approved') toast.success(t('Approved'), 'approve');
    else if (outcome === 'gone') toast.show(t('No longer waiting for you'));
    else if (outcome === 'open') toast.show(t('Open it to decide.'), 'info', { label: t('Open'), onPress: () => router.push(route as Href) });
  }, [queryClient, workspaceId, t, toast, router]);

  useEffect(() => { void registerApprovalCategories(t).catch(() => undefined); }, [t]);

  useEffect(() => {
    if (!native) return;
    void sendPendingApprovals(report);
    const returning = AppState.addEventListener('change', (state) => { if (state === 'active') void sendPendingApprovals(report); });
    return () => returning.remove();
  }, [report]);

  useEffect(() => {
    if (!native) return;
    const open = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      // The last response survives a sign-in (the layout mounts again): each push opens once.
      const identifier = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (opened.has(identifier)) return;
      opened.add(identifier);
      if (response.actionIdentifier === APPROVE_ACTION && await approveFromNotice(response, report)) return;
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
  }, [router, api, t, toast, queryClient, workspaceId, report]);

  useEffect(() => {
    if (!native || !enabled) return;
    void Notifications.setBadgeCountAsync(unread).catch(() => undefined);
  }, [unread, enabled]);
  // Signed out or another workspace: the badge no longer counts anything.
  useEffect(() => () => { if (native) void Notifications.setBadgeCountAsync(0).catch(() => undefined); }, [workspaceId]);
}
