import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { authClient } from '../../auth/provider';
import type { T } from '../../core/i18n';
import { afterRetry, APPROVE_ACTION, approvalKey, enqueue, OPEN_ACTION, outcomeOf, parsePending, pushApproval, stillDue, type ApprovalOutcome, type PendingApproval, type PushApproval } from './approval-action-model';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const STORE = 'wodana.approvals.pending.v1';

/**
 * The buttons an approval notice shows (X-2). On iOS, Approve runs in the background and the phone asks for Face ID
 * or the passcode first. Android can't ask for that on a background action, so there Approve opens the app (which
 * needs the phone unlocked) and approves at once. Registered again when the language changes.
 */
export async function registerApprovalCategories(t: T) {
  if (!native) return;
  const approve = Platform.OS === 'ios' ? { opensAppToForeground: false, isAuthenticationRequired: true } : { opensAppToForeground: true };
  const open = { identifier: OPEN_ACTION, buttonTitle: t('Open'), options: { opensAppToForeground: true } };
  await Notifications.setNotificationCategoryAsync('approval', [{ identifier: APPROVE_ACTION, buttonTitle: t('Approve'), options: approve }, open]);
  // A day's report: approving it also sends it to the client.
  await Notifications.setNotificationCategoryAsync('approval_send', [{ identifier: APPROVE_ACTION, buttonTitle: t('Approve & send'), options: approve }, open]);
}

const load = async () => parsePending(await AsyncStorage.getItem(STORE).catch(() => null));
const save = (list: PendingApproval[]) => (list.length ? AsyncStorage.setItem(STORE, JSON.stringify(list)) : AsyncStorage.removeItem(STORE)).catch(() => undefined);

export type ApprovalReport = (outcome: ApprovalOutcome, item: PushApproval) => void;
// One pass at a time: a tap while earlier decisions are still being sent waits its turn.
let running: Promise<void> = Promise.resolve();

/**
 * Sends the decisions saved on the phone, as the signed-in person, in the workspace each one came from; reports
 * each outcome. A connection problem keeps the decision for the next time the app runs (a day at most).
 */
export function sendPendingApprovals(report: ApprovalReport): Promise<void> {
  running = running.then(async () => {
    let list = stillDue(await load(), Date.now());
    if (!list.length) { await save(list); return; }
    let state = authClient.getSnapshot();
    if (state.status !== 'signedIn' || state.offline) { await authClient.restore().catch(() => undefined); state = authClient.getSnapshot(); }
    if (state.status !== 'signedIn') return;
    for (const item of [...list]) {
      let outcome: ApprovalOutcome;
      if (item.workspaceId !== state.workspaceId) outcome = 'open';
      else {
        try {
          await authClient.api(`/workspaces/${item.workspaceId}/approvals/decide`, 'POST', { kind: item.kind, id: item.id, decision: 'approve', note: '' });
          outcome = 'approved';
        } catch (error) { outcome = outcomeOf(error); }
      }
      list = list.filter((entry) => approvalKey(entry) !== approvalKey(item));
      if (outcome === 'retry') {
        // Kept for the next time the app runs; after the last try the person is asked to open it.
        const next = afterRetry(item);
        if (next === 'open') report('open', item);
        else list.push(next);
        continue;
      }
      report(outcome, item);
    }
    await save(list);
  }).catch(() => undefined);
  return running;
}

/**
 * A tapped Approve: the decision is saved on the phone first (so it survives the app being closed), the notice is
 * cleared, then it's sent. False when this notice can't be approved from a tap; the caller opens it instead.
 */
export async function approveFromNotice(response: Notifications.NotificationResponse, report: ApprovalReport) {
  const item = pushApproval(response.notification.request.content);
  if (!item) return false;
  await save(enqueue(await load(), item, Date.now()));
  void Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => undefined);
  await sendPendingApprovals(report);
  return true;
}

/** Tells the person how a decision went while the app is in the background: a quiet local notice (one that opens the row when it needs them). */
export function noticeFor(t: T, outcome: ApprovalOutcome, item: PushApproval): Notifications.NotificationContentInput | null {
  if (outcome === 'approved') return { title: t('Approved'), body: item.title };
  if (outcome === 'gone') return { title: t('No longer waiting for you'), body: item.title };
  if (outcome === 'open') return { title: t('Open it to decide.'), body: item.title, data: { workspaceId: item.workspaceId, deepLink: item.deepLink ?? '/workspace/approvals' } };
  return null;
}

export function postNotice(content: Notifications.NotificationContentInput | null) {
  if (!native || !content) return;
  void Notifications.scheduleNotificationAsync({ content: { ...content, sound: false }, trigger: null }).catch(() => undefined);
}
